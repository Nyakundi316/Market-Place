import { BadRequestException } from '@nestjs/common';

/** Keyset cursor over (timestamp, id) — stable under concurrent inserts. */
export type TimeCursor = { t: string; id: string };

export const encodeCursor = (c: TimeCursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string | undefined): TimeCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as TimeCursor;
    if (typeof c?.t === 'string' && typeof c.id === 'string' && !Number.isNaN(Date.parse(c.t)))
      return c;
  } catch {
    /* fall through */
  }
  throw new BadRequestException({ message: 'Invalid cursor', fields: { cursor: ['Invalid'] } });
}

/** Rows strictly after the cursor in (field desc, id desc) order. */
export function olderThan(field: string, c: TimeCursor | null) {
  if (!c) return {};
  const t = new Date(c.t);
  return { OR: [{ [field]: { lt: t } }, { [field]: t, id: { lt: c.id } }] };
}

/** Slices a `take: limit + 1` result into a page and the next cursor. */
export function pageOf<R extends { id: string }>(
  rows: R[],
  limit: number,
  at: (row: R) => Date | null,
) {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const t = last && at(last);
  return {
    page,
    nextCursor:
      rows.length > limit && last && t ? encodeCursor({ t: t.toISOString(), id: last.id }) : null,
  };
}
