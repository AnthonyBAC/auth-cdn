import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { z } from "zod";

import { apiError } from "@/lib/api/errors";

// Compartido por las dos rutas: formato, validación y traducción de errores SQL.
export async function cardOperation<T>(
  request: Request,
  cardId: string,
  schema: z.ZodType<T>,
  supabase: SupabaseClient,
  operation: "schedule_card_reminders" | "complete_card",
  argumentsFor: (input: T) => Record<string, unknown>
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId)) {
    return apiError("BAD_REQUEST", "El identificador de la tarjeta no es válido.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("BAD_REQUEST", "El cuerpo debe ser JSON válido.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError("BAD_REQUEST", "Revisa los datos de la tarjeta.", parsed.error.flatten());

  const { data, error } = await supabase.rpc(operation, {
    target_card_id: cardId,
    ...argumentsFor(parsed.data)
  });
  if (error) {
    if (error.code === "42501") return apiError("FORBIDDEN", "No puedes realizar esta operación sobre la tarjeta.");
    if (error.code === "40001") return apiError("CONFLICT", "La tarjeta cambió. Actualiza los datos y vuelve a intentarlo.");
    if (error.code === "22023") return apiError("BAD_REQUEST", error.message);
    return apiError("INTERNAL_ERROR", "No se pudo guardar el cambio. Inténtalo nuevamente.");
  }
  return NextResponse.json({ card: data });
}
