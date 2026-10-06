import { z } from 'zod';

export const MAX_PAGE_SIZE = 50; // §0

export const cursorQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
