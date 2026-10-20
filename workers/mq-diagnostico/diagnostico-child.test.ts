// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ejecutarChildConnx, extraerProbeId } from "./diagnostico";

describe("MQCONNX en proceso hijo", () => {
  it.skipIf(process.platform === "win32")("ejecuta el hijo en dry-run sin conectarse a MQ y sin modificar HOME del padre", async () => {
    const homeAntes = process.env.HOME;

    const resultado = await ejecutarChildConnx(true);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.hijo.resultado).toBe("DRY_RUN");
      // El wrapper /bin/sh fija RLIMIT_CORE=0 y el hijo lo verifica vía /proc/self/limits.
      expect(resultado.coreDumpsDeshabilitados).toBe(true);
      // Sin MQCONNX no se genera el directorio de errores del cliente.
      expect(resultado.errores.directorioExiste).toBe(false);
      expect(resultado.mqm.directorioExiste).toBe(true);
      expect(resultado.mqm.total).toBe(0);
      expect(resultado.probeIds).toEqual([]);
    }
    expect(process.env.HOME).toBe(homeAntes);
  });

  it("extrae solo el Probe Id de un FDC con un patrón permitido", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mq-fdc-"));
    try {
      const conProbe = join(dir, "AMQ12345.0.FDC");
      await writeFile(conProbe, "Cabecera\nProbe Id :- ZZ001234\nOtra línea sensible: no se devuelve\n");
      expect(await extraerProbeId(conProbe)).toBe("ZZ001234");

      const sinProbe = join(dir, "AMQ00000.0.FDC");
      await writeFile(sinProbe, "sin probe id aquí\n");
      expect(await extraerProbeId(sinProbe)).toBeNull();

      const tokenInvalido = join(dir, "AMQ00001.0.FDC");
      await writeFile(tokenInvalido, "Probe Id :- SECRET_PASSWORD_123\n");
      expect(await extraerProbeId(tokenInvalido)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
