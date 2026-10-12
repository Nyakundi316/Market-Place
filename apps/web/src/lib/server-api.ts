// Server components only: reads API_INTERNAL_URL, which browsers never see.
// Same origin the /api rewrite targets (next.config.mjs). Server components call Nest directly.
const API_ORIGIN = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:3001';

/**
 * Anonymous, cached reads for server-rendered public pages (SEO). Viewer-specific
 * fields (isFavorited, isOwner) are refetched on the client with the session.
 * Returns null on 404 so pages can call notFound().
 */
export async function serverGet<T>(path: string, revalidate = 30): Promise<T | null> {
  const res = await fetch(`${API_ORIGIN}${path}`, { next: { revalidate } }).catch(() => null);
  if (!res || res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return (await res.json()) as T;
}
