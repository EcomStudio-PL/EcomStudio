# Frontend

- App Router, server components by default; client components only where
  interactivity demands (drawer, toolbar, sheets, forms).
- Design tokens in `app/globals.css` (`--bg`, `--accent` = magenta
  240 60 224 dark / 226 0 214 light, category accents, mobile chrome tokens
  `--bottom-nav-h/--dock-h/--page-bottom/--gen-page-bottom/--page-x`).
- Theme: next-themes, class strategy (`.dark`), default dark.
- Brand: single component `components/layout/brand.tsx` using official
  assets in `public/brand/` (CSS theme swap, fixed dimensions).
- i18n: PL/EN/DE dictionaries in `lib/i18n/dictionaries/*.json`; `makeT`
  server, `useI18n` client. makeT returns the KEY on a miss (two historical
  bugs came from assuming empty-string fallback).
- Mobile system: `.rail-x`/`.rail-x-sm` carousels, `<Media>` (aspect-stable
  shimmer frames), `<BottomSheet>`, derived bottom padding so fixed bars
  never cover content.
- Fonts self-hosted via @fontsource-variable (Inter, Space Grotesk).
