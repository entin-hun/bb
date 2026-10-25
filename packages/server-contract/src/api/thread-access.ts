import { z } from "zod";

export const threadParticipantRoleSchema = z.enum([
  "owner",
  "maintainer",
  "member",
  "viewer",
]);
export type ThreadParticipantRole = z.infer<typeof threadParticipantRoleSchema>;

export const threadInviteRoleSchema = z.enum([
  "maintainer",
  "member",
  "viewer",
]);
export type ThreadInviteRole = z.infer<typeof threadInviteRoleSchema>;

export const threadParticipantSchema = z.object({
  createdAt: z.number().int(),
  email: z.string().email(),
  name: z.string(),
  role: threadParticipantRoleSchema,
  threadId: z.string().min(1),
  updatedAt: z.number().int(),
  userId: z.string().min(1),
});
export type ThreadParticipant = z.infer<typeof threadParticipantSchema>;

export const threadInviteSchema = z.object({
  acceptedAt: z.number().int().nullable(),
  acceptedByUserId: z.string().min(1).nullable(),
  createdAt: z.number().int(),
  email: z.string().email().nullable(),
  expiresAt: z.number().int(),
  id: z.string().min(1),
  revokedAt: z.number().int().nullable(),
  role: threadInviteRoleSchema,
  threadId: z.string().min(1),
});
export type ThreadInvite = z.infer<typeof threadInviteSchema>;

export const createThreadInviteRequestSchema = z.object({
  email: z.string().email().nullable().default(null),
  expiresInHours: z.number().int().min(1).max(168).default(24),
  role: threadInviteRoleSchema.default("member"),
});
export type CreateThreadInviteRequest = z.infer<
  typeof createThreadInviteRequestSchema
>;

export interface CreateThreadInviteResponse {
  invite: ThreadInvite;
  url: string;
}

export const addThreadParticipantRequestSchema = z.object({
  email: z.string().email(),
  role: threadInviteRoleSchema.default("member"),
});
export type AddThreadParticipantRequest = z.infer<
  typeof addThreadParticipantRequestSchema
>;

export const updateThreadParticipantRequestSchema = z.object({
  role: threadParticipantRoleSchema,
});
export type UpdateThreadParticipantRequest = z.infer<
  typeof updateThreadParticipantRequestSchema
>;

export interface ThreadAccessResponse {
  currentRole: ThreadParticipantRole | null;
  invites: ThreadInvite[];
  participants: ThreadParticipant[];
}

export interface ThreadInvitePreview {
  email: string | null;
  expiresAt: number;
  role: ThreadInviteRole;
  threadId: string;
}

export interface AuthSessionResponse {
  enabled: boolean;
  user: {
    email: string;
    id: string;
    image: string | null;
    name: string;
  } | null;
}
