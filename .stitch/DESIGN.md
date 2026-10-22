# Design System: MarketHub
**Project ID:** not created yet. Fill this in after the first `create_project` call.

Source of truth: `apps/web/src/app/globals.css` and `apps/web/tailwind.config.ts`. If they disagree with this file, the code is right. Update this file to match.

_Direction since 2026-10-20: **market-stall editorial**._

## 1. Visual Theme & Atmosphere

A local marketplace for Kenya and the region: phones, sofas, cars, plumbers, jobs. The feel is **a good newspaper's classifieds pages crossed with a market stall**: an off-white "paper" canvas, near-black green "ink" text, editorial serif headlines, hairline rules, and prices written on saffron swing tags hung on the photos. The product photos supply the colour, and the interface steps back.

- Calm and trustworthy, because money moves through escrow. Character comes from type and rules, not from effects.
- Dense in the way classifieds are dense: lots of listings per screen, scannable prices.
- Pages are asymmetric and left-weighted inside a centred column. Each page opens with a masthead: a small uppercase kicker, a serif headline, and (on Discover and categories) a blurb ruled off to the right. There are no centred hero blocks.

## 2. Color Palette & Roles

### Light (default)
| Name | Hex | Role |
|---|---|---|
| Paper | `#F7F5F0` | Page canvas, top bar (90% + blur), bottom nav |
| Card White | `#FFFFFF` | Cards, inputs, popovers, the chat pane |
| Ink | `#14201B` | Headings, prices, body text; active nav underline; active filter pill; the "Featured" badge |
| Slate Moss | `#54635D` | Secondary text: kickers, location, time, condition, placeholders, inactive rail tabs |
| Market Green | `#0F7B5F` | Primary actions ("Sell something", "Make offer"), your chat bubbles, focus ring and focused search rule, the "Open to offers" stamp |
| Mint Wash | `#E1EAE6` | Escrow ticket, active conversation row, avatar wells |
| Sand | `#EAE7E1` | Image placeholder, skeletons |
| Hairline | `#DCD8D0` | Rules: rail, filter sections, dividers, inputs |
| Saffron | `#F2A93B` (text on it `#39240E`) | **Prices**: the swing tag on photos and in the chat header. Also the wordmark dot and the dot before "Featured". Nothing else. |
| Verified Blue | `#1A63C9` | ID-verified / business-verified seller badge only |
| Clay Red | `#C0480C` | Destructive actions, filled "saved" heart |

### Dark
Canvas `#0E1613`, cards `#141F1A`, text `#EFECE7`, primary brightens to `#2EB88A`. Saffron is unchanged.

## 3. Typography Rules

- **UI and body:** Geist (variable), system sans fallback. Stylistic sets `ss01` and `cv11` are on. Weights 400 and 600, plus 500 for small labels.
- **Display:** Fraunces (`font-display`; a self-hosted variable woff2 like Geist, SIL OFL), with `SOFT` 60 and optical sizing so it reads warm rather than bookish. Used for headlines and headline numbers only, weight 500 (600 for prices):
  - Discover masthead "Fresh from sellers near you.": 32px → 36px → 52px at desktop, line height 1.05
  - Category title: 32px → 36px → 48px
  - Listing title: 28px → 34px; listing price: 32px → 40px semibold, tabular
  - Section headings: "Just listed" 24px → 28px; "Featured" (after a saffron dot) and the listing page's "Description" / "Details" 20px
  - The 2×2 lead tile's title: 20px → 24px; "Chats": 30px; the offer card amount: 26px semibold
  - The search query on `/search`: 20px → 24px → 36px
- **Kicker:** 12px, weight 500, uppercase, 0.14em tracking, Slate Moss ("DISCOVER", "ELECTRONICS · LAPTOPS & COMPUTERS", "FILTERS", chat day dividers).
- **Card price:** inside the swing tag, 14px semibold tabular, `KES 32,000`; ranges over 14 characters drop to 12px rather than truncate. "NEG." follows at 10px uppercase, 70% opacity. On half-width phone cards it is dropped for prices over 10 characters (from KES 100,000), where it would wrap the tag.
- **Listing title on cards:** 14px regular, at most 2 lines. **Meta line:** 12px Slate Moss with a map-pin icon, `Nairobi, KE · 2 days ago`.

## 4. Component Stylings

- **Radius:** 10px base (`--radius: 0.625rem`). Card photos 8px, inputs and buttons 10px, the gallery 12px, pills fully round, badges and the stamp 6px.
- **Top bar** (replaces the sidebar): sticky, 56px on phones and 64px from 1024px, Paper at 90% with backdrop blur and a hairline below. Wordmark, then search, then (desktop) text nav links Discover · Saved · Chats · Deals with a 2px Ink underline on the active one, then "+ Sell something", the bell and the avatar menu (Log in / Sign up when signed out). Desktop search is a 40px white pill input ("Search phones, sofas, plumbers…", ellipsised when narrow); on phones it is a pill link to `/search`. It hides on `/search`, which has its own.
- **Bottom nav** (below 1024px): Discover, Saved, Sell (raised green circle), Chats, Deals. Active tab: Ink label and a 2px Ink bar on the nav's top edge; Saved fills its heart.
- **Swing-tag price:** Saffron fill, dark brown text, a notched left edge (clip-path) with a punched hole that shows the photo through it (mask), 0.3rem radius on the right. Bottom-left of the photo, nudging 2px right on hover. Class `.price-tag`.
- **Listing card:** no box; the photo is the card. 4:3 photo, 8px radius, Sand while loading, the swing tag bottom-left, a 36px white heart button (90%, blur) top-right, an Ink "FEATURED" badge top-left. Title, meta and condition sit directly on Paper below.
- **Lead tile:** the first listing in the Discover grid spans 2 columns and (from 640px) 2 rows; its photo fills both rows and its title is set in the display serif.
- **Category rail** (replaces chips): text tabs between a hairline above and below, 14px Slate Moss, active = Ink, 500 weight, 2px Ink underline. One line that scrolls sideways and fades out at the right edge; on phones it bleeds to the screen edges.
- **Search on `/search`:** no box. The query is the page's headline: display serif on a 2px Ink rule with a magnifier at the left. Focus turns the rule Market Green and thickens it.
- **Filters column:** "FILTERS" kicker on a 2px Ink rule, then sections separated by hairlines. Type pills are white with a hairline border; the active one fills with Ink.
- **Listing page:** category kicker, serif title, location and time, then the headline price with an **"Open to offers" stamp** (1.5px green border, 10px bold uppercase, rotated −2°). "Details" is a printed price list: label, dotted leader, value. The **escrow ticket** is a Mint Wash stub: a 3rem column with the shield, a dashed perforation with semicircle bites out of the top and bottom edge (class `.ticket`), then the note.
- **Chat:** desktop is one framed white pane (inbox + thread) filling the viewport under the top bar. The thread header pins the listing: thumbnail, title, swing tag. Day dividers are kicker labels between hairlines. The offer card's amount is in the display serif.
- **Elevation:** the card shadow is a warm, almost invisible 1px hairline with a 3px blur at 6% ink. A stronger "lift" shadow (`0 8px 24px -12px` at 25% ink) is used only for menus, popovers and the raised Sell button.

## 5. Layout Principles

- The top bar and the content share one centred column, at most 72rem (1152px), with 16px gutters on phones and 32px from 1024px. Inside it, content is left-weighted: mastheads sit left, blurbs are ruled off to the right.
- The listing grid uses 2 columns on phone, 3 from 640px and 4 from 1280px. Gaps are 12px / 28px on phones and 20px / 36px from 1024px. Discover's grid opens with the 2×2 lead tile; search and category results don't.
- Featured is a **horizontal scroll strip**, not a second grid. It gives a taste and breaks the rhythm of the main grid.
- On phones the listing gallery bleeds to the screen edges and up to the top bar.
- Anything sticky on desktop sits at `top-24`, clear of the 64px bar.
- Vertical rhythm: 24–32px from masthead to rail, 32–48px between sections.

## 6. Motion

Only a few things move:
- The masthead enters with a 220ms, 6px rise and fade.
- The lead tile fades in from 98% scale over 500ms.
- Card photos scale to 1.03 on hover over 300ms, and the swing tag slides 2px right.
- The heart button presses down to 0.9.
- Everything else stays still. Reduced-motion settings turn all of it off.

## 7. Don'ts

- Don't use centred, symmetric hero sections or a marketing banner on the Discover page.
- Don't use solid brand-green image placeholders. Placeholders are Sand with a faint icon.
- Don't use Saffron for anything but prices and the two dots. It is the only warm accent.
- Don't box the search query on `/search`, and don't let the category rail wrap to a second line.
- Don't use bold display type; Fraunces stays at 500 (600 for prices).
- Don't use gradients, glassmorphism panels or heavy drop shadows.
