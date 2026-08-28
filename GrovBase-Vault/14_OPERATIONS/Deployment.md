# Deployment

Established flow (do not invent new projects):
1. Work on the working branch; commit; push to it AND mirror to `main`.
2. `npx tsc --noEmit` + `npm run build` + unit tests must pass BEFORE
   deploying.
3. Deploy via Vercel deploy_to_vercel to project ecomstudio-prod
   (installCommand clones `main`; seeds stub package.json +
   .env.production with the three env NAMES listed in Environments).
4. Verify READY, then smoke test: /login 200 + headers, QA login E2E.
5. Apply any new migration to PROD via Supabase migration API BEFORE the
   deploy that needs it (all migrations must be backward-safe so old code
   tolerates the new schema during the window).
6. Update vault: changelog entry + Current State.
