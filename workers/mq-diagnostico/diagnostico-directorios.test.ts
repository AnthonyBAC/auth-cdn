// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  describirDirectorio,
  ejecutarDiagnosticoDirectorios,
  listarDirectorio
} from "./diagnostico";

describe("directorios HOME/.mqm y MQ_OVERRIDE_DATA_PATH", () => {
  it("describe un directorio existente y escribible", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mq-dir-test-"));
    try {
      const resultado = await describirDirectorio(dir);
      expect(resultado).toEqual({ configurado: true, existe: true, esDirectorio: true, escribible: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("describe un directorio inexistente", async () => {
    const resultado = await describirDirectorio(join(tmpdir(), "no-existe-xyz-123"));
    expect(resultado.existe).toBe(false);
    expect(resultado.esDirectorio).toBe(false);
    expect(resultado.escribible).toBe(false);
  });

  it("describe una ruta no configurada", async () => {
    expect(await describirDirectorio(undefined)).toEqual({
      configurado: false,
      existe: false,
      esDirectorio: false,
      escribible: false
    });
  });

  it.skipIf(process.platform === "win32")("prepara y confirma HOME/.mqm y MQ_OVERRIDE_DATA_PATH escribibles", async () => {
    const resultado = await ejecutarDiagnosticoDirectorios();
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.preparado.home.escribible).toBe(true);
      expect(resultado.preparado.mqm.escribible).toBe(true);
      expect(resultado.preparado.dataPath.escribible).toBe(true);
    }
  });

  it("lista nombres y tamaños de los artefactos sin leer contenido", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mq-list-test-"));
    const contenido = "CONTENIDO_SENSIBLE_QUE_NO_SE_DEVUELVE";
    await writeFile(join(dir, "AMQ99999.0.FDC"), contenido);
    try {
      const resultado = await listarDirectorio(dir);
      expect(resultado.directorioExiste).toBe(true);
      expect(resultado.ficheros).toEqual([
        { nombre: "AMQ99999.0.FDC", tamano: Buffer.byteLength(contenido) }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
