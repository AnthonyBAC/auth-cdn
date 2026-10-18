import { describe, expect, it } from "vitest";
import { fromLocalDateInput, toLocalDateInput, formatCardDate } from "@/lib/cards/fechas";

describe("fechas del formulario", () => {
  it("conserva segundos, milisegundos y desplazamiento de una fecha sin cambios", () => {
    const original = "2030-01-03T10:45:12.345-03:00";
    expect(fromLocalDateInput(toLocalDateInput(original), original)).toBe(original);
  });
  it("convierte una edición local a un instante UTC", () => {
    const local = "2030-02-03T14:20";
    const utc = fromLocalDateInput(local, null);
    expect(utc).toBe(new Date(2030, 1, 3, 14, 20).toISOString());
    expect(toLocalDateInput(utc)).toBe(local);
  });
  it("permite limpiar y rechaza fechas que JavaScript normalizaría silenciosamente", () => {
    expect(fromLocalDateInput("", "2030-01-01T00:00:00Z")).toBeNull();
    expect(() => fromLocalDateInput("2030-02-31T12:00", null)).toThrow();
    expect(() => fromLocalDateInput("incorrecta", null)).toThrow();
  });
  it("el resumen usa la zona explícita del workspace", () => {
    expect(formatCardDate("2030-01-03T12:00:00Z", "America/Santiago"))
      .not.toBe(formatCardDate("2030-01-03T12:00:00Z", "UTC"));
  });
});
