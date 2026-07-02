# Marketing Website Plan — Mission Control

## Route (safety first)
- `/` is the PROTECTED dashboard (proxy.ts session gate) — untouched.
- The marketing site lives at **`/landing`** via a new route group `app/(marketing)/landing/` with its
  own layout (NO AppShell). `/landing` is added to the proxy PUBLIC list (page only — no API becomes
  public; the fleet APIs keep their gates).
- CTA "Open Dashboard" → `/` (unauthenticated visitors land on `/login` — existing behaviour, correct).

## Visual direction
Apple-inspired liquid glass on a dark luxe background — an extension of the dashboard's design system
(`.glass*` tokens) but bigger, deeper and more spatial: layered translucent panels, top-edge
highlights, slow floating orbs, CSS `perspective` + `preserve-3d` tilts, soft depth shadows, quiet
glows. No neon overload, no Apple assets/copy. All 3D is CSS (no new dependencies).

## Component structure (all under `components/marketing/`)
- `shared.tsx` — MarketingNav (client: mobile drawer), MarketingFooter, SectionHeader,
  LiquidGlassCard, GlassButton, FloatingBadge, Pill, GlassOrbBackground.
- One file per section, fixed exports (the page imports these names):
  `hero.tsx → HeroSection` · `problem.tsx → ProblemSection` · `solution.tsx → SolutionSection` ·
  `features.tsx → FeaturesSection` · `how-it-works.tsx → HowItWorksSection` ·
  `token-optimization.tsx → TokenOptimizationSection` · `phone-control.tsx → PhoneControlSection` ·
  `safety.tsx → SafetySection` · `war-room-section.tsx → WarRoomSection` ·
  `use-cases.tsx → UseCasesSection` · `final-cta.tsx → FinalCTASection`.
- Sections are server components (CSS-only motion/hover); client only where interaction demands it.

## Sections (order on the page)
Nav → Hero (3D dashboard mockup + floating cards) → Problem (6 glass cards) → Solution (layered
system diagram) → Features (bento grid, mixed sizes, mini mockups) → How It Works (5-step 3D rail) →
Token Optimization (compression visual + example-labeled metrics) → Phone Control (3D phone mockup +
command chat) → Safety (8 trust cards) → War Room (large mockup) → Use Cases (7 cards) → Final CTA →
Footer.

## 3D approach (CSS only)
`.mk-scene` (perspective container) + `.mk-tilt` (rotateX/rotateY at rest, flattens on hover) +
`.mk-float` (slow translate/rotate keyframes) + `.mk-depth` (layered translateZ children with
`preserve-3d`). Mockups are pure HTML/CSS (crisp at any DPI, no images). `prefers-reduced-motion`
collapses ALL motion (global rule already exists); tilts get a static fallback.

## Liquid glass system
Reuses the dashboard tokens + adds a marketing layer in globals.css under an `mk-` namespace:
`.mk-glass` (hero-grade panel: deeper blur, brighter top highlight, layered shadow), `.mk-orb`
(animated gradient orbs), `.mk-grad-text` (premium gradient headline), `.mk-section` (rhythm),
`.mk-ring` (inner border highlight). CSS variables only — no scattered hardcoded colors.

## Responsive
Desktop: spatial, big mockups, bento grids. Tablet: 2-col grids, tamed tilts. Mobile: stacked,
nav drawer, simplified 3D (tilt off via media query), no horizontal overflow, CTAs prominent.

## Risks to dashboard/auth + mitigation
- proxy.ts change is a one-line PUBLIC addition for the page path only (verified by smoke: /landing
  200 unauthenticated, / still redirects, APIs still gated).
- Route group has its own layout → AppShell/dashboard untouched. No shared component is modified.

## Implementation order
1. Foundation (this plan, proxy PUBLIC, (marketing) layout + metadata, shared.tsx, mk- CSS).
2. Parallel section builds (4 workstreams on disjoint files) + page assembly.
3. Adversarial review (responsive/overflow/a11y/consistency/copy) → fixes.
4. build + tsc + tests + smoke (public /landing, gated /), deploy.
