import { describe, expect, it } from "vitest";

import {
  calcularEstadisticas,
  expiracionEnDecimas,
  resumenReplySchema,
  resumenRequestSchema
} from "@/modules/ibm-mq/domain/resumen";

const request = {
  schemaVersion: 1,
  requestId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-10-19T12:00:00.000Z",
  expiresAt: "2026-10-19T12:00:10.000Z"
};

const replyOk = {
  schemaVersion: 1,
  requestId: request.requestId,
  boardId: request.boardId,
  status: "OK",
  generatedAt: "2026-10-19T12:00:01.000Z",
  stats: { totalActive: 4, pending: 2, completed: 1, overdue: 1 }
};

describe("Contrato de resumen Request/Reply", () => {
  it("acepta una solicitud válida y no transporta credenciales", () => {
    expect(resumenRequestSchema.parse(request)).toEqual(request);
    expect(() => resumenRequestSchema.parse({ ...request, accessToken: "jwt" })).toThrow();
    expect(() => resumenRequestSchema.parse({ ...request, password: "secreto" })).toThrow();
  });

  it("rechaza identificadores inválidos y expiración no posterior", () => {
    expect(() => resumenRequestSchema.parse({ ...request, boardId: "no-uuid" })).toThrow();
    expect(() =>
      resumenRequestSchema.parse({ ...request, expiresAt: request.createdAt })
    ).toThrow();
  });

  it("acepta respuestas OK y ERROR coherentes", () => {
    expect(resumenReplySchema.parse(replyOk)).toMatchObject({ status: "OK" });

    expect(
      resumenReplySchema.parse({
        ...replyOk,
        status: "ERROR",
        stats: null,
        error: { code: "FORBIDDEN", message: "Sin acceso." }
      })
    ).toMatchObject({ status: "ERROR" });

    expect(() =>
      resumenReplySchema.parse({
        ...replyOk,
        status: "ERROR",
        stats: null
      })
    ).toThrow();

    expect(() =>
      resumenReplySchema.parse({
        ...replyOk,
        status: "ERROR",
        error: { code: "INTERNAL_ERROR", message: "Fallo." }
      })
    ).toThrow();

    const { stats: _stats, ...sinStats } = replyOk;
    void _stats;
    expect(() => resumenReplySchema.parse(sinStats)).toThrow();

    expect(() =>
      resumenReplySchema.parse({
        ...replyOk,
        stats: { totalActive: 5, pending: 2, completed: 1, overdue: 1 }
      })
    ).toThrow();
  });

  it("clasifica tarjetas en categorías mutuamente excluyentes", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    const stats = calcularEstadisticas(
      [
        { completedAt: "2026-10-19T11:00:00.000Z", dueAt: "2026-10-18T12:00:00.000Z" },
        { completedAt: null, dueAt: "2026-10-19T11:59:59.999Z" },
        { completedAt: null, dueAt: "2026-10-19T12:00:00.000Z" },
        { completedAt: null, dueAt: "2026-10-20T12:00:00.000Z" },
        { completedAt: null, dueAt: null }
      ],
      now
    );

    expect(stats).toEqual({ totalActive: 5, pending: 3, completed: 1, overdue: 1 });
    expect(stats.pending + stats.completed + stats.overdue).toBe(stats.totalActive);
  });

  it("calcula la expiración MQ en décimas y rechaza una fecha ya vencida", () => {
    expect(
      expiracionEnDecimas("2026-10-19T12:00:01.099Z", Date.parse("2026-10-19T12:00:00.000Z"))
    ).toBe(10);
    expect(() =>
      expiracionEnDecimas("2026-10-19T12:00:00.000Z", Date.parse("2026-10-19T12:00:00.000Z"))
    ).toThrow();
  });
});
