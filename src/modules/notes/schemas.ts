import { z } from "zod";

// Tags are case-insensitive: normalized to lowercase so "Work" and "work" are one tag.
const tag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "tags are 1-32 chars: letters, digits, '_' or '-'");

const tags = z
  .array(tag)
  .max(20)
  .transform((t) => [...new Set(t)].sort()); // sorted to match how reads return them

const title = z.string().trim().min(1).max(200);
const body = z.string().max(100_000);

export const createNoteSchema = z.object({
  title,
  body: body.default(""),
  tags: tags.default([]),
  teamId: z.string().min(1).nullable().default(null),
});

export const updateNoteSchema = z
  .object({
    title,
    body,
    tags,
    teamId: z.string().min(1).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const listNotesQuerySchema = z.object({
  tag: tag.optional(),
  teamId: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export type CreateNoteInput = z.output<typeof createNoteSchema>;
export type UpdateNoteInput = z.output<typeof updateNoteSchema>;
export type ListNotesQuery = z.output<typeof listNotesQuerySchema>;
