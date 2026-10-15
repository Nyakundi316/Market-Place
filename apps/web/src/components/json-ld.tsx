import { jsonLdString } from '@/lib/seo';

/** Structured data for search engines; content is escaped in jsonLdString. */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON-LD must be raw; `<` is escaped
      dangerouslySetInnerHTML={{ __html: jsonLdString(data) }}
    />
  );
}
