# Discover (desktop): Stitch prompt

Tool: `generate_screen_from_text` · deviceType: `DESKTOP`

---

The Discover feed for MarketHub, a local Kenyan marketplace for products, services and jobs. It should feel calm, warm and trustworthy, like classifieds on good paper: dense, scannable listings, with real product photography carrying the colour while the interface stays quiet. The layout is left-weighted and asymmetric, with nothing centred in the viewport.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, desktop-first, 1440px wide frame
- Canvas: Paper off-white (#F7F5F0). Cards and inputs: white (#FFFFFF). Hairline borders: #DCD8D0
- Text: Ink near-black green (#14201B) for headings and prices, Slate Moss (#54635D) for secondary text
- Primary action: Market Green (#0F7B5F) with off-white text
- Active / selected wash: Mint (#E1EAE6)
- Single warm accent: Saffron (#F2A93B), used only for the "Featured" badge and the dot in the logo
- Verified seller badge: blue (#1A63C9) small check-shield icon
- Typography: Geist (or Inter) sans-serif, weights 400 and 600 only; prices use tabular numerals
- Shape: 10px corner radius on cards, inputs and buttons; pill-shaped chips; 4px on badges
- Depth: almost flat. A whisper-soft 1px warm shadow on the search field only; no heavy shadows, no gradients

**PAGE STRUCTURE:**

1. **Left sidebar (fixed, 232px, Paper with a hairline right border):**
   - Top: lowercase wordmark "markethub" in Market Green with a small Saffron dot after it; bell icon button on the right
   - Full-width Market Green button "+ Sell something"
   - Nav list with icon-label pairs: Discover (active, Mint rounded-rectangle background), Search, Chats (small green unread count "3"), Deals
   - Pinned to bottom: hairline divider, then a circular initials avatar "BN", name "Brian Nya", handle "@wyakundi"

2. **Content column (starts right at the sidebar edge, 40px left padding, fills the remaining width):**
   - **Top row (one horizontal line, left-aligned):** a 44px white search field (about 520px wide) with a magnifier icon and placeholder "Search phones, sofas, plumbers…", then a city picker pill button "📍 Nairobi ▾" beside it. No page hero, no banner.
   - **Category row:** ONE single-line horizontal scroll of pill chips, each with a small line icon: Electronics, Vehicles, Property, Home & Garden, Fashion, Health & Beauty, Baby & Kids, Agriculture, Services, Jobs. White fill, hairline border. The row fades out at the right edge to hint at more. It must not wrap to a second line.
   - **Featured strip:** small uppercase label "FEATURED" in Slate Moss, then a horizontal scroll row of 4 wider cards (3:2 photos) with a Saffron "FEATURED" badge on each photo. Use real photos: a silver Toyota Fielder, a grey 3-seater sofa, an iPhone 14 Pro, a 2-bedroom apartment living room.
   - **"Just listed" section:** heading "Just listed" on the left, a small "Newest ▾" sort text button on the far right of the same line.
     - A 5-column card grid, 20px column gap, 24px row gap, 2 rows visible.
     - Each card has no box or border: a 4:3 photo with 10px radius, and a 36px white semi-transparent circular heart button in its top-right corner.
     - Below the photo, directly on Paper, three tight lines:
       - Price, bold, e.g. "KES 32,000", followed by a tiny uppercase "NEG." in Slate Moss
       - Title, one line: "Samsung Galaxy A54 128GB"
       - Meta line in 12px Slate Moss: map-pin icon, "Kisumu · just now · Good", plus a small blue verified badge on some cards
     - Vary the photos and prices realistically: Pixel 8 Pro (KES 78,000), a wooden dining set (KES 24,500), a Sony PS5 (KES 61,000), a baby stroller (KES 9,800), a mountain bike (KES 18,000), a 32" LG TV (KES 21,000), a leather office chair (KES 12,500), a dairy cow in a green field (KES 85,000), a MacBook Air M2 (KES 115,000), a Ramtons fridge (KES 34,000).
   - **"Services near you" strip (breaks up the grid):** heading on the left, "See all" link on the right. A horizontal row of 3 compact white cards with a hairline border and 10px radius. Each card shows a circular provider photo on the left and, on the right, the service name ("Plumbing & leak repair"), provider "Otieno Fixers", a star rating "4.8 (126)" and "from KES 1,500" in Market Green.

**AVOID:** centred hero sections, marketing banners, solid-colour image placeholders, gradients, glassmorphism, more than one accent colour, and wrapping the category chips onto two lines.
