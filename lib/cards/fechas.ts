// datetime-local usa la zona horaria del navegador; la API recibe una fecha absoluta.
export function toLocalDateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalDateInput(value: string, original: string | null): string | null {
  if (!value) return null;
  // Conserva segundos y zona de una fecha que el usuario no modificó.
  if (original && value === toLocalDateInput(original)) return original;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || toLocalDateInput(date.toISOString()) !== value) {
    throw new Error("La fecha u hora no es válida en tu zona horaria.");
  }
  return date.toISOString();
}

export function formatCardDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}
