# Marketing Website (/landing)

## Route & separation from the dashboard
- The public site lives at **`/landing`** in its own route group `app/(marketing)/` with its own
  layout (`layout.tsx`: SEO/OpenGraph/Twitter metadata, no AppShell). It prerenders as static.
- `proxy.ts` allowlists **only the `/landing` page path** — every dashboard route and every API keeps
  its session/token gate. "Open Dashboard" CTAs link to `/`; unauthenticated visitors land on `/login`
  (existing behaviour).
- Nothing in `(app)`/AppShell/auth was modified for this site.

## Components (`components/marketing/`)
- `shared.tsx` — server-component primitives: GlassButton, LiquidGlassCard, Pill, ExampleChip,
  ACCENT_TONES, FloatingBadge (aria-hidden + pointer-events-none), SectionHeader, GlassOrbBackground,
  MarketingFooter.
- `nav.tsx` — MarketingNav (the only client component: mobile drawer; scroll-capped).
- One file per section: `hero` (3D dashboard mockup + floating PR/token/phone badges), `problem`,
  `solution` (layered system diagram User→Manager→Specialists→Gates→PR→Ship), `features` (bento grid
  with mini CSS mockups), `how-it-works` (5-step rail), `token-optimization` (messy context →
  optimization engine → compact package visual), `phone-control` (3D phone with generic command chat),
  `safety`, `war-room-section` (large mockup), `use-cases`, `final-cta`.
- Page assembly: `app/(marketing)/landing/page.tsx` (imports the fixed exports).

## Liquid glass approach
The `mk-` layer in `app/globals.css` extends the dashboard tokens: `.mk-glass` (hero-grade panel:
blur(22px)+saturate, double inner highlight, layered depth shadow, `@supports` fallback for
no-backdrop-filter), `.mk-grad-text`, `.mk-lift` (deep hover), `.mk-orb` (slow GPU-cheap drift),
`.mk-section` rhythm. No hardcoded one-off palettes — accents come from `ACCENT_TONES`.

## 3D approach (CSS only — no new dependencies)
`.mk-scene` (perspective 1600px) + `.mk-tilt`/`.mk-tilt-r` (resting rotateX/rotateY, eases flatter on
hover — hover only on `(hover:hover) and (pointer:fine)`), `.mk-3d` (preserve-3d) and `.mk-z-*`
translateZ offsets for layered mockup children; `.mk-float*` for orbiting badges. **All transforms
collapse on `max-width:768px`, `(hover:none)` and `prefers-reduced-motion`** — mobile gets flat,
fast sections. Mockups are pure HTML/CSS (crisp at any DPI, no images to load).

## Copy rules
English, premium, concrete, no hype. Any illustrative number carries the shared `ExampleChip` — no
unproven claims. To change copy: every section's text lives inline in its own file; shared CTAs/nav
labels in `nav.tsx`/`shared.tsx`.

## Verified
- `tsc --noEmit` clean · full unit suite green · `next build` green (`/landing` static).
- Adversarial review (3 lenses: responsive/a11y, design consistency, copy/claims) → 26 findings, all
  applied (mobile drawer scroll, contrast floors, Example chips, anchor ids, overflow guards).
- Smoke: `/landing` HTTP 200 **without** a session; `/` still redirects to `/login`; APIs still gated.

## Known TODOs
- No real product screenshots — mockups are stylized CSS (intentional for now; swap for captured
  screenshots when the brand look settles).
- No dedicated OG image yet (metadata is in place; add `opengraph-image` when there's a brand asset).
- Footer "Docs & Knowledge"/"Config" point to the dashboard root (protected) — point to public docs
  if/when those exist.
- Copy is v1 — pricing/get-started flow deliberately absent until the product is sellable.
