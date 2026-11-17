// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { evaluarArchivos, ejecutarIntegridad } from "../../../legacy/mq-diagnostico/diagnostico";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("integridad del keystore TLS", () => {
  it("compara bytes reconstruidos contra los SHA-256 originales", () => {
    const kdb = Buffer.from("contenido-kdb");
    const sth = Buffer.from("contenido-sth");

    const resultado = evaluarArchivos(
      { kdb, sth, rdb: null },
      { kdb: sha("contenido-kdb"), sth: sha("contenido-sth") }
    );

    expect(resultado.kdb).toEqual({ existe: true, tamano: kdb.length, coincide: true });
    expect(resultado.sth).toEqual({ existe: true, tamano: sth.length, coincide: true });
    expect(resultado.rdb).toEqual({ existe: false, tamano: 0, coincide: false });
  });

  it("marca no-coincidencia cuando el hash difiere", () => {
    const resultado = evaluarArchivos(
      { kdb: Buffer.from("real"), sth: null, rdb: null },
      { kdb: sha("otro") }
    );
    expect(resultado.kdb.existe).toBe(true);
    expect(resultado.kdb.coincide).toBe(false);
  });

  it("ignora hashes esperados con formato inválido", () => {
    const resultado = evaluarArchivos(
      { kdb: Buffer.from("real"), sth: null, rdb: null },
      { kdb: "no-es-hex" }
    );
    expect(resultado.kdb.existe).toBe(true);
    expect(resultado.kdb.coincide).toBe(false);
  });

  it.skipIf(process.platform === "win32")("reconstruye desde Base64 y compara de extremo a extremo sin ejecutar MQ", async () => {
    vi.stubEnv("MQ_TLS_KEY_REPOSITORY_BASE64", Buffer.from("contenido-kdb").toString("base64"));
    vi.stubEnv("MQ_TLS_KEY_STH_BASE64", Buffer.from("contenido-sth").toString("base64"));
    vi.stubEnv("MQ_TLS_KEY_RDB_BASE64", "");
    vi.stubEnv("MQ_TLS_KEY_REPOSITORY", "");

    const resultado = await ejecutarIntegridad({
      kdb: sha("contenido-kdb"),
      sth: sha("contenido-sth")
    });

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.prefijoConsistente).toBe(true);
      expect(resultado.archivos.kdb).toEqual({
        existe: true,
        tamano: "contenido-kdb".length,
        coincide: true
      });
      expect(resultado.archivos.sth.coincide).toBe(true);
      expect(resultado.archivos.rdb.existe).toBe(false);
    }

    vi.unstubAllEnvs();
  });

  it("devuelve error de entorno si no hay keystore configurado", async () => {
    vi.stubEnv("MQ_TLS_KEY_REPOSITORY_BASE64", "");
    vi.stubEnv("MQ_TLS_KEY_STH_BASE64", "");
    vi.stubEnv("MQ_TLS_KEY_RDB_BASE64", "");
    vi.stubEnv("MQ_TLS_KEY_REPOSITORY", "");

    const resultado = await ejecutarIntegridad({});

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error.code).toBe("ENVIRONMENT");
    }

    vi.unstubAllEnvs();
  });
});
