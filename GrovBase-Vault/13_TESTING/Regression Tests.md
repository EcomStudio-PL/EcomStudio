# Regression Tests (must stay green)
1. Login works on FIRST attempt on a cold deployment (clock-skew guard).
2. Session survives refresh, new tab, PWA reopen (cookie attributes).
3. Logged-out /home → /login?next=/home; logout clears sb-* cookies.
4. Non-admin /admin → redirect; admin actions refuse non-admin.
5. Quote equals charge for every model/resolution/mode combination.
6. Failed generation refunds exactly once.
7. No page renders "Pr…"-style clipped labels at 320–430 px.
8. Zero CSP violations in console on core pages.
9. Blocked user sees blocked screen and CANNOT self-unblock via PostgREST.
