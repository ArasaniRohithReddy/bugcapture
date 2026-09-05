import { z } from 'zod/v4';

/** Permissive schema – strict about required fields, passthrough for the rest. */
export const BugReportSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    createdAt: z.number(),
  })
  .catchall(z.unknown());

export const AiGenerateSchema = z.object({
  system: z.string(),
  user: z.string(),
  model: z.string().optional().default('gpt-4o-mini'),
  stream: z.boolean().optional().default(false),
});

export type AiGenerateBody = z.infer<typeof AiGenerateSchema>;
