import { timingSafeEqual } from "node:crypto";

export function validSecret(received: string | null, expected: string | undefined) {
  if (!expected || expected.length < 32 || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
