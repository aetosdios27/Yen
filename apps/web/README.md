# `@yen/web`

Next.js app for Yen. This package owns the shared design system every later
frontend issue consumes (YEN-13).

## Design system

Open `/design-system` in the dev server for the phone-width review page. It is
constrained to 375 px and shows every token and component state, including the
expanded `en-XA` pseudo-locale for long-string testing.

```sh
cp apps/web/.env.example apps/web/.env
pnpm --filter @yen/web dev
# http://localhost:3000/design-system
```

### Tokens

Tokens live in [`src/styles/tokens.css`](src/styles/tokens.css) and are exposed
as Tailwind v4 theme variables (`bg-canvas`, `text-body`, `min-h` via
`tap-target`, `max-w-phone`, and so on).

- Body text is 18 px; supporting text never drops below 16 px.
- Interactive controls use a 48 px minimum via the `tap-target` class.
- Text, action and status colour pairs meet 7:1; supporting text meets 4.5:1;
  focus rings and control borders meet 3:1. `src/styles/tokens.test.ts` parses
  the CSS and fails if a token regresses.

### Components

`src/components/` exports `Button`, `Input`, `Money`, `StatusBadge`, `Timeline`,
`Stepper`, `Toast` and `EmptyState`. Details that are easy to regress:

- `Money` only accepts the branded `Paise` type and formats through
  `formatInr`, never through floating-point maths.
- `StatusBadge` always renders a word plus a distinct icon, never colour alone.
- `Input` keeps its live error region mounted, links hint/error IDs through
  `aria-describedby`, and sets `aria-invalid` when there is an error.
- `Toast` uses a `role="status"` live region and keeps the dismiss button
  outside it; Escape closes the toast.
- `Timeline` and `Stepper` are ordered lists. Steps expose `aria-current` and a
  spoken "Step X of Y" label.

### Languages

English and Hindi catalogues live in `src/i18n/messages/`. The English file is
the source of truth: `Messages` and `MessageKey` are derived from it, so a
missing Hindi key or an unknown `t()` key fails typecheck.

`LocaleProvider` keeps the locale in React state, so the whole shell updates
without a reload. `en-XA` is generated from English with accents and ~40%
padding, and is exposed in the language selector outside production builds.

Plain language rules apply to every user-facing string: use **record**,
**proof** and **account book**, never hash, block, ledger, wallet or on-chain.
`src/i18n/messages.test.ts` enforces this.

## Checks

```sh
pnpm --filter @yen/shared build   # once, so @yen/web can resolve its dist
pnpm --filter @yen/web typecheck
pnpm --filter @yen/web test       # includes axe
pnpm --filter @yen/web test:a11y  # named axe-only CI step
pnpm --filter @yen/web build
```

`vitest-axe` runs with zero allowed violations for each component and for the
whole `/design-system` page in English, Hindi and the pseudo-locale.

## Progressive Web App (PWA)

Yen is installed as a Progressive Web App (PWA) on mobile and desktop, keeping it a lightweight, accessible web experience without native app store friction.

### What is cached vs. never cached

The service worker (`public/sw.js`) and its caching rules module (`public/sw-rules.js`) adhere to strict transparency boundaries:

- **What is cached:**
  - **Precached:** The offline fallback page (`/offline`), the web manifest (`/manifest.webmanifest`), and app icons (`/icons/*`, `/favicon.ico`).
  - **Runtime-cached:** Same-origin `GET` requests for immutable static build assets (`/_next/static/*`), icons, and fonts (`.woff2`, `.woff`, etc.).
- **What is NEVER cached:**
  - **Never cache anything under `/v1/`:** All API requests always bypass the cache and hit the network.
  - **Never cache non-GET requests:** `POST`, `PUT`, `DELETE`, `PATCH`, and `HEAD` requests are never cached.
  - **Never cache cross-origin requests:** Only same-origin assets are eligible.
  - **Never cache responses with `Cache-Control: no-store` or `private`:** Cache privacy directives are strictly respected.
  - **Never cache HTML documents other than `/offline`:** Navigations are network-first and only fall back to `/offline` if the network fails.

### Bumping the cache version

The cache version is defined in `apps/web/public/sw-rules.js`:

```js
export const CACHE_VERSION = "v1";
```

To invalidate all existing static caches across client devices, bump `CACHE_VERSION` (e.g., to `"v2"`). When the updated service worker activates, `cleanOldCaches` deletes all previous `yen-*` caches and claims clients.

### iPhone and iOS notifications

On iOS Safari, Web Push notifications are only supported when a site has been explicitly added to the Home Screen. Because many community members are on older phones or use Safari without installing, Yen does not rely on web push: critical transaction receipts, approvals, and notifications are sent via WhatsApp and SMS instead.

### Manual installability checklist

Verify PWA readiness in Chromium-based browsers:

1. **Manifest:** Visit `http://localhost:3000/manifest.webmanifest` and verify valid JSON with `name: "Yen"`, `short_name: "Yen"`, `display: "standalone"`, `theme_color: "#14532d"`, `background_color: "#ffffff"`, and icons.
2. **Icons:** Verify `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (with safe-zone padding), and `apple-touch-icon.png` load correctly.
3. **Service worker:** Build for production (`pnpm --filter @yen/web build && pnpm --filter @yen/web start`) and verify in DevTools > Application > Service Workers that `/sw.js` registers successfully.
4. **Offline fallback:** In DevTools Network tab, switch to "Offline" and refresh any page; verify the honest `/offline` page loads in English or Hindi.
5. **Install banner:** On first paint, verify no banner is shown. On a second page view in the session (or when `trigger={true}`), verify the banner appears, is accessible, and can be dismissed (remembered in `localStorage`).
6. **iPhone guide:** On iOS Safari or simulated iOS User-Agent, tap "Add to Home Screen on iPhone" to inspect step-by-step instructions.
