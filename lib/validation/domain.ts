import { z } from "zod";

import { roles } from "@/lib/rbac/permissions";

const requiredText = (max: number) => z.string().trim().min(1).max(max);

export const workspaceInput = z.object({
  name: requiredText(100)
});

export const boardInput = z.object({
  title: requiredText(100)
});

export const listInput = z.object({
  title: requiredText(100),
  position: z.number().finite().optional()
});

export const cardInput = z.object({
  title: requiredText(200),
  description: z.string().max(10_000).optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable()
});

export const cardMoveInput = z.object({
  listId: z.string().uuid(),
  position: z.number().finite().optional()
});

export const memberRoleInput = z.object({
  role: z.enum(roles as ["owner", "editor", "viewer"])
});

export const invitationInput = z.object({
  email: z.string().trim().email().toLowerCase(),
  role: z.enum(roles as ["owner", "editor", "viewer"])
});

export const locationInput = z.object({
  locationName: requiredText(120),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().trim().min(1).max(80).optional()
});
