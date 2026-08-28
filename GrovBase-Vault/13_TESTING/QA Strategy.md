# QA Strategy
- Unit: `npm run test:tools`, `npm run test:concepts` (esbuild-bundled,
  no network).
- Static: `npx tsc --noEmit`, production build.
- Live E2E: Playwright (headless chromium) against production with the QA
  account — login-first-attempt, refresh, protected routes, logout, admin
  gate, CSP-violation listener, horizontal-overflow probe at 320–1920.
- QA account: e2e-test-claude@ecomstudio.test — kept blocked=true at rest;
  unblock for a test window, re-block after (operator toggles the profiles
  trigger OFF/ON around the update).
