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

`.gitleaks-baseline.json` pins the four findings that exist today. The workflow
passes `--baseline-path`, so only findings that are **new relative to that file**
fail the build.

This was deliberately chosen over a path or regex allowlist. An allowlist on
`scripts/comm-tests.ts` would blind the scanner to that file permanently,
including a real key committed there next month. The baseline suppresses only
the findings already in it — four report entries over three distinct lines;
`scripts/comm-tests.ts:34` is recorded twice because that line matches under
more than one report entry. Nothing else is suppressed.

### A BASELINE IS ONLY VALID FOR THE HISTORY IT WAS BUILT FROM

A gitleaks fingerprint is `commit:file:rule:line`. The **commit** is part of it,
so a baseline generated in a SHALLOW clone pins fingerprints that do not exist
in the real history, and fails to pin the ones that do.

That is not hypothetical — it is what happened here, and it left CI red on
every run from 2026-09-18 to 2026-09-20 without anyone reading the log:

  - This repository is cloned shallow in the agent environment (`.git/shallow`,
    HEAD truncated to 117 commits). Under the graft, the commit that "introduces"
    `scripts/comm-tests.ts:34` looked like `3318ad7a`; in real history it is
    `a65c3bf5`.
  - So the baseline pinned two fingerprints (`3318ad7a…:34`, `c0ca6860…:38`)
    that **no commit in the real repository produces**, while the real finding
    went unsuppressed.
  - CI checks out with `fetch-depth: 0` and therefore sees the true history:
    274 commits and `leaks found: 2`, exit 1, on every push.
  - The local verification that pronounced it clean scanned 205 commits and
    reported `no leaks found`. Both were run honestly; they were simply not
    looking at the same repository. The "174 commits" figure recorded in an
    earlier version of this file was the same blind spot.

**Before regenerating or trusting this baseline, run `git rev-parse
--is-shallow-repository`. If it prints `true`, run `git fetch --unshallow`
first.** A scan of a truncated history is not a scan of the repository, and a
baseline built from one silences the wrong things.

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

## The known findings — all false positives

Verified individually at their commits on 2026-09-18, and re-verified against
the **full** 274-commit history on 2026-09-20. None is a credential.

| File | What it actually is |
|---|---|
| `lib/mail/transport.ts:54` | The i18n key `comm.hint.imapSmtpPort`, caught by the `generic-api-key` entropy heuristic inside a port-advice function. A translation id, not a secret. |
| `scripts/photoroom-tests.ts:58` | Synthetic `LIVE` / `SANDBOX` apiKey fixtures for a unit test whose `fetch` is mocked. |
| `scripts/comm-tests.ts:34` (×2) | A fake Telegram bot token used to assert that `safeError()` **strips** tokens out of error strings. Deleting it would delete the test that proves redaction works. |

The `:38` entry from the earlier baseline is gone — it was a shallow-clone
artifact, not a second finding. The fixture is flagged only at line 34.

The last one is worth keeping in mind: the scanner is flagging the fixture whose
whole purpose is to prove secrets do not leak.

## Verification performed

Re-run on 2026-09-20 against the **unshallowed** repository, with the same
pinned binary CI uses (8.28.0, sha256 verified):

- Full history scan: **274 commits**, 15.2 MB, 4 findings, **0 real secrets**.
- With the regenerated baseline: `no leaks found`, **exit 0** — matching what CI
  computes, which the previous baseline did not.
- Mutation test: planted fabricated Stripe, GitHub-PAT and generic high-entropy
  keys on a throwaway commit; **3 caught, exit 1**, including one under
  `generic-api-key` — the same rule the baseline suppresses. So the baseline
  suppresses four fingerprints, not a rule and not a file.

Two probes that did *not* fire, recorded so they are not mistaken for coverage:

- `sk-live-…` with a hyphen — no rule matches that shape.
- `AKIAIOSFODNN7EXAMPLE` — AWS's own published documentation key, which the
  default ruleset allowlists deliberately. A mutation test built on it reports a
  clean scan and proves nothing. Use a fabricated high-entropy value instead.

gitleaks detects known credential formats and keyword-adjacent high entropy —
not "anything that looks random".

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

Only after confirming every new entry is genuinely benign — and only from a
complete clone, or the result will pin fingerprints CI never produces:

```sh
[ "$(git rev-parse --is-shallow-repository)" = true ] && git fetch --unshallow
gitleaks git --redact --report-format json \
  --report-path .gitleaks-baseline.json \
  --config .gitleaks.toml --exit-code 0
```

Then confirm the commit count matches what the CI log reports. If it does not,
the baseline is being built against a different repository than the one that
gates the build.

Then record in this file what each new entry is and why it is safe. A baseline
without that explanation is just a silenced alarm.
