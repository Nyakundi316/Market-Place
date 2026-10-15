/**
 * The app icon, drawn with the same parts as the wordmark: a lowercase "m"
 * and the saffron stall dot on brand green. Rendered by next/og, so there are
 * no binary assets to keep in sync.
 */
export function BrandMark({ size, maskable = false }: { size: number; maskable?: boolean }) {
  // Maskable icons get cropped to a circle by Android: keep the glyph in the safe zone.
  const glyph = Math.round(size * (maskable ? 0.5 : 0.62));
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f7b5f',
        borderRadius: maskable ? 0 : Math.round(size * 0.22),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: -glyph * 0.08 }}>
        <span
          style={{
            color: '#f6f3ee',
            fontSize: glyph,
            fontWeight: 800,
            letterSpacing: -glyph * 0.04,
            lineHeight: 1,
          }}
        >
          m
        </span>
        <span
          style={{
            width: glyph * 0.17,
            height: glyph * 0.17,
            marginTop: glyph * 0.2,
            marginLeft: glyph * 0.03,
            borderRadius: '50%',
            background: '#f2a93b',
          }}
        />
      </div>
    </div>
  );
}
