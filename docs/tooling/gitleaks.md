# Gitleaks

Secret scanning over the whole commit history, on every push and pull request.

## Why it is configured the way it is

**The repository is public.** `EcomStudio-PL/EcomStudio` has `visibility: public`,
so every blob that has ever been committed is readable by anyone, forever. Two
consequences drive the setup:

1. The scan runs against **history**, not the working tree (`gitleaks git` with
   `fetch-depth: 0`). Deleting a file does not un-publish the key that was in it.
2. Everything runs with `--redact`. A CI log on a public repo is public; a
   scanner that prints the secret it found turns a private leak into a published
   one.

**The repository is owned by an organization.** `gitleaks/gitleaks-action`
requires a `GITLEAKS_LICENSE` for org-owned repos. The gitleaks CLI itself is
MIT-licensed with no such requirement, so the workflow downloads the release
binary — pinned to a version *and* a sha256 — instead of using the Action
wrapper. Same scanner, same rules, no licence key to store or rotate.

## The baseline, and why it is not an allowlist

`.gitleaks-baseline.json` pins the six findings that exist today. The workflow
passes `--baseline-path`, so only findings that are **new relative to that file**
fail the build.

This was deliberately chosen over a path or regex allowlist. An allowlist on
`scripts/comm-tests.ts` would blind the scanner to that file permanently,
including a real key committed there next month. The baseline suppresses only
the findings already in it — six report entries, which resolve to **four
distinct fingerprints** (`commit:file:rule:line`); two of the four are recorded
twice because the same line matches under more than one report entry. Nothing
else is suppressed.

The baseline file itself is safe to commit: it was generated with `--redact`, so
every `Secret` field in it reads `REDACTED`.

## The `.env.example` allowlist is scoped, not global

`.gitleaks.toml` also allowlists the placeholder values in the tracked
`.env.example`. It uses `matchCondition = "AND"` with a `paths` pattern, so a
finding is dropped only when it is **both** in `.env.example` **and** matches a
placeholder shape.

The regex list on its own would have applied to the entire history — any file,
any commit — which is wider than intended: a real credential that happened to
contain `your-…-key` anywhere in the repo would have been silently dropped.
Verified after narrowing: a Stripe-shaped key in a file outside `.env.example`
with `// your-secret-key` alongside it is still caught (exit 1).

## The six known findings — all false positives

Verified individually at their commits on 2026-09-18. None is a credential.

| File | What it actually is |
|---|---|
| `lib/mail/transport.ts:54` | The i18n key `comm.hint.imapSmtpPort`, caught by the `generic-api-key` entropy heuristic inside a port-advice function. A translation id, not a secret. |
| `scripts/photoroom-tests.ts:58` | Synthetic `LIVE` / `SANDBOX` apiKey fixtures for a unit test whose `fetch` is mocked. |
| `scripts/comm-tests.ts:34, :38` | A fake Telegram bot token used to assert that `safeError()` **strips** tokens out of error strings. Deleting it would delete the test that proves redaction works. |

The last one is worth keeping in mind: the scanner is flagging the fixture whose
whole purpose is to prove secrets do not leak.

## Verification performed

- Full history scan: 174 commits, 14.5 MB, **0 real secrets**.
- With baseline: `no leaks found`, exit 0.
- Mutation test: planted synthetic AWS, Stripe and GitHub-PAT formatted keys in
  an untracked file; **3 caught, exit 1**. The baseline does not blind the rules.
  (A first attempt using `sk-live-…` with a hyphen was *not* caught — no rule
  matches that shape. Worth knowing: gitleaks detects known credential formats
  and keyword-adjacent high entropy, not "anything that looks random".)

## When a real secret is found

Order matters, and it is not the obvious one.

1. **Rotate/revoke at the provider first** — Supabase, OpenAI, FAL, Google,
   Vercel, SMTP/IMAP, Telegram. The key is compromised from the moment it was
   pushed to a public repo, regardless of how fast the commit was removed.
2. Update the value in Vercel env / Supabase Vault.
3. Only then decide whether rewriting git history is worth it. On a public repo
   assume the old value was scraped; history rewriting is cosmetic after the fact.
4. Re-run the scan.

Never "fix" a leak by deleting the file and committing that as the remedy.

## Regenerating the baseline

Only after confirming every new entry is genuinely benign:

```sh
gitleaks git --redact --report-format json \
  --report-path .gitleaks-baseline.json \
  --config .gitleaks.toml --exit-code 0
```

Then record in this file what each new entry is and why it is safe. A baseline
without that explanation is just a silenced alarm.
