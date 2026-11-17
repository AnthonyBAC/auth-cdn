import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

import {
  ErrorMqResumen,
  ErrorRespuestaResumen,
  ErrorTimeoutResumen,
  type SolicitanteResumen
} from "./solicitante";

const LIMITE_CUERPO = 16 * 1024;

const entradaSchema = z
  .object({
    boardId: z.string().uuid(),
    userId: z.string().uuid()
  })
  .strict();

function responderJson(res: ServerResponse, status: number, payload: unknown): void {
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": cuerpo.length,
    "cache-control": "no-store"
  });
  res.end(cuerpo);
}

function tokenValido(recibido: string | undefined, esperado: string): boolean {
  if (!recibido) return false;
  const a = Buffer.from(recibido, "utf8");
  const b = Buffer.from(esperado, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  const partes: Buffer[] = [];
  let total = 0;

  for await (const parte of req) {
    const chunk = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
    total += chunk.length;
    if (total > LIMITE_CUERPO) {
      throw new Error("CUERPO_DEMASIADO_GRANDE");
    }
    partes.push(chunk);
  }

  return Buffer.concat(partes).toString("utf8");
}

function errorHttp(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof ErrorTimeoutResumen) {
    return { status: 504, code: "TIMEOUT", message: error.message };
  }
  if (error instanceof ErrorRespuestaResumen) {
    return { status: 502, code: "INVALID_REPLY", message: error.message };
  }
  if (error instanceof ErrorMqResumen) {
    return { status: 502, code: "MQ_ERROR", message: error.message };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "No se pudo procesar la solicitud de resumen."
  };
}

export function crearServidorResumen(
  solicitante: SolicitanteResumen,
  token: string
): Server {
  return createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/resumen") {
      responderJson(res, 404, { error: { code: "NOT_FOUND", message: "Ruta no encontrada." } });
      return;
    }

    const tokenRecibido = req.headers["x-mq-bridge-token"];
    const recibido = Array.isArray(tokenRecibido) ? tokenRecibido[0] : tokenRecibido;

    if (!tokenValido(recibido, token)) {
      responderJson(res, 401, { error: { code: "UNAUTHENTICATED", message: "Token interno inválido." } });
      return;
    }

    let cuerpo: string;
    try {
      cuerpo = await leerCuerpo(req);
    } catch {
      responderJson(res, 413, {
        error: { code: "BAD_REQUEST", message: "El cuerpo de la solicitud es demasiado grande." }
      });
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(cuerpo);
    } catch {
      responderJson(res, 400, { error: { code: "BAD_REQUEST", message: "JSON inválido." } });
      return;
    }

    const entrada = entradaSchema.safeParse(json);
    if (!entrada.success) {
      responderJson(res, 400, {
        error: { code: "BAD_REQUEST", message: "La solicitud interna no es válida." }
      });
      return;
    }

    try {
      const reply = await solicitante.solicitar(entrada.data);
      responderJson(res, 200, { reply });
    } catch (error) {
      const mapped = errorHttp(error);
      responderJson(res, mapped.status, {
        error: { code: mapped.code, message: mapped.message }
      });
    }
  });
}
