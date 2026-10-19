import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import {
  ejecutarChildConnx,
  ejecutarDiagnostico,
  ejecutarDiagnosticoArtefactos,
  ejecutarDiagnosticoDirectorios,
  ejecutarIntegridad,
  ETAPAS,
  ETAPA_CHILD_CONNX,
  ETAPA_DIAGNOSTICOS,
  ETAPA_DIRECTORIOS,
  ETAPA_INTEGRIDAD,
  type Etapa
} from "@/lib/mq/diagnostico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

function secretoValido(recibido: string | null, esperado: string): boolean {
  const a = Buffer.from(recibido ?? "", "utf8");
  const b = Buffer.from(esperado, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Diagnóstico operativo de conectividad IBM MQ. Protegido por un secreto de
// servidor; no usa la sesión del usuario ni permite credenciales de usuario final.
// Parámetro opcional ?stage=entorno|load|init|connx|open para aislar el fallo.
export async function GET(request: Request) {
  const secreto = process.env.MQ_POC_SECRET;
  if (!secreto) {
    return NextResponse.json(
      { error: { code: "NOT_CONFIGURED", message: "MQ_POC_SECRET no está configurado." } },
      { status: 503, headers: SIN_CACHE }
    );
  }

  const recibido = request.headers.get("x-mq-poc-secret");
  if (!secretoValido(recibido, secreto)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Secreto inválido." } },
      { status: 401, headers: SIN_CACHE }
    );
  }

  const stageRaw = new URL(request.url).searchParams.get("stage") ?? "open";
  const etapasDisponibles: (
    | Etapa
    | typeof ETAPA_INTEGRIDAD
    | typeof ETAPA_DIRECTORIOS
    | typeof ETAPA_DIAGNOSTICOS
    | typeof ETAPA_CHILD_CONNX
  )[] = [...ETAPAS, ETAPA_INTEGRIDAD, ETAPA_DIRECTORIOS, ETAPA_DIAGNOSTICOS, ETAPA_CHILD_CONNX];
  if (
    !etapasDisponibles.includes(
      stageRaw as
        | Etapa
        | typeof ETAPA_INTEGRIDAD
        | typeof ETAPA_DIRECTORIOS
        | typeof ETAPA_DIAGNOSTICOS
        | typeof ETAPA_CHILD_CONNX
    )
  ) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: `stage inválido. Usa: ${etapasDisponibles.join(" | ")}.`
        }
      },
      { status: 400, headers: SIN_CACHE }
    );
  }

  if (stageRaw === ETAPA_INTEGRIDAD) {
    const esperados = {
      kdb: request.headers.get("x-mq-poc-kdb-sha256") ?? undefined,
      sth: request.headers.get("x-mq-poc-sth-sha256") ?? undefined,
      rdb: request.headers.get("x-mq-poc-rdb-sha256") ?? undefined
    };
    const resultado = await ejecutarIntegridad(esperados);
    return NextResponse.json(resultado, {
      status: resultado.ok ? 200 : 500,
      headers: SIN_CACHE
    });
  }

  if (stageRaw === ETAPA_DIRECTORIOS) {
    const resultado = await ejecutarDiagnosticoDirectorios();
    return NextResponse.json(resultado, {
      status: resultado.ok ? 200 : 500,
      headers: SIN_CACHE
    });
  }

  if (stageRaw === ETAPA_DIAGNOSTICOS) {
    const resultado = await ejecutarDiagnosticoArtefactos();
    return NextResponse.json(resultado, {
      status: resultado.ok ? 200 : 500,
      headers: SIN_CACHE
    });
  }

  if (stageRaw === ETAPA_CHILD_CONNX) {
    const dry = new URL(request.url).searchParams.get("dry") === "1";
    const resultado = await ejecutarChildConnx(dry);
    return NextResponse.json(resultado, {
      status: resultado.ok ? 200 : 500,
      headers: SIN_CACHE
    });
  }

  const etapa = stageRaw as Etapa;

  try {
    const resultado = await ejecutarDiagnostico(etapa);
    return NextResponse.json(resultado, { status: resultado.ok ? 200 : 502, headers: SIN_CACHE });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL",
          message: "El diagnóstico terminó de forma inesperada."
        }
      },
      { status: 500, headers: SIN_CACHE }
    );
  }
}
