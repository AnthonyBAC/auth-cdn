import { z } from "zod";

export const registerInput = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8),
  name: z.string().trim().min(1).max(80)
});

export const loginInput = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1)
});
