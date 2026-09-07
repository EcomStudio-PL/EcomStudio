# Admin route migration — old → new

Written for the Stage 3 information-architecture rebuild. Every route below
still resolves. Nothing was deleted; the retired screens are redirects, and no
database table was dropped to tidy up a menu.

## Moved into the communication module

| Old route | New route | Notes |
|---|---|---|
| `/admin/mail` | `/admin/communication` | Skrzynka — the IMAP client, unchanged |
| `/admin/notifications` | `/admin/communication/powiadomienia` | The event switchboard and delivery log |
| `/admin/email/templates` | `/admin/communication/szablony` | Template studio |
| `/admin/email` | `/admin/communication/kanaly` | Sender identity + waitlist confirmation copy |
| `/admin/settings/integrations` | `/admin/communication/kanaly` | Mail / Telegram / captcha cards |

The two old mail screens are now one tab. The SMTP transport (host, port,
encryption, user, password) is editable **only** on the mailbox card there;
`email_settings` receives it through the existing mirror, which is no longer
optional. The sender identity and the confirmation copy still live in
`email_settings` and are still edited on that tab.

## Removed from the menu, kept as routes

| Old route | Redirects to | Why |
|---|---|---|
| `/admin/workspaces` | `/admin/users` | A read-only list of rows; every action an operator takes on a workspace happens through the customer record. The table and its RLS are untouched. |
| `/admin/products` | `/admin/generations` | Same: a listing with no operator action on it. `products` is untouched. |

## Already redirects before this change

| Old route | Redirects to |
|---|---|
| `/admin/homepage` | `/admin/www` |
| `/admin/launch` | `/admin/www/premiera` |

## Renamed in the menu only (route unchanged)

| Route | Was called | Now called |
|---|---|---|
| `/admin/system` | System | Zaawansowane |

## Newly reachable

| Route | Notes |
|---|---|
| `/admin/settings/registration` | Has existed and worked since migration 0055. No menu anywhere linked to it, so the only way in was to type the URL. It is now the last-but-two entry under SYSTEM. |

## The new menu

```
PRZEGLĄD              /admin · /admin/analytics
KLIENCI I KOMUNIKACJA /admin/users · /admin/communication · /admin/support
FINANSE               /admin/credits · /admin/plans · /admin/services
AI I GENEROWANIE      /admin/generations · /admin/models · /admin/providers ·
                      /admin/engine · /admin/concepts · /admin/templates · /admin/tools
MARKETING I WWW       /admin/www · /admin/waitlist · /admin/inspirations · /admin/media
SYSTEM                /admin/settings/access · /admin/settings/features ·
                      /admin/settings/security · /admin/settings/onboarding ·
                      /admin/settings/registration · /admin/logs · /admin/system (Zaawansowane)
```

## Deep links updated to match

- `lib/server/telegram-notification.ts` — the "Otwórz skrzynkę" button on the
  `mail.received` card now points at `/admin/communication`.
- `components/admin/notification-prefs.tsx` — the "configure a channel" link
  now points at the Kanały tab.
- `app/actions/integrations.ts` — `revalidatePath` was calling
  `/admin/communications`, a route that has never existed, so every revalidate
  there was silently a no-op. It now names the real routes.
- `app/actions/templates.ts`, `app/actions/launch.ts` — same, retargeted.
