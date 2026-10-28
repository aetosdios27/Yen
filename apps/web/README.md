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
