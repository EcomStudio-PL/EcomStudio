# CodeQL — MANUAL ACTION REQUIRED

Status: **not enabled.** This is the one guardrail in the pre-remediation layer
that cannot be turned on from the repository, and it was left off deliberately
rather than half-configured.

## Why there is no `codeql.yml` in this repo

GitHub offers two mutually exclusive ways to run CodeQL:

- **Default setup** — configured in the repository UI, GitHub maintains the
  query pack and the build steps.
- **Advanced setup** — a `.github/workflows/codeql.yml` you own.

Enabling Default setup while an advanced workflow exists is an error, and the
advanced workflow wins in ways that are easy to misread. Since Default setup is
the recommended option here — GrovBase is a plain TypeScript app with nothing
unusual to compile, so there is no reason to hand-maintain a query pipeline —
committing a workflow would actively block the better option.

**GrovBase is a public repository**, so CodeQL and code scanning are available
at no cost and with no GitHub Advanced Security licence.

## Exact steps

1. Open `https://github.com/EcomStudio-PL/EcomStudio`.
2. **Settings** → in the left sidebar, **Advanced Security** (older layouts show
   this as **Code security and analysis**).
3. Find the **CodeQL analysis** row.
4. Click **Set up** → choose **Default**.
5. A configuration panel opens. Confirm:
   - **Languages** includes `JavaScript/TypeScript`. It should be detected
     automatically — this repo is ~100% TypeScript.
   - **Query suite** stays on the recommended/default set. Do not switch to
     `security-extended` yet; see below.
6. Click **Enable CodeQL**.
7. Go to the **Actions** tab. A workflow named *CodeQL* starts within a minute.
   First run takes roughly 3–6 minutes on a repo this size.

## What you should see

- **Actions** tab: a green *CodeQL* run.
- **Security** → **Code scanning**: an alert list, possibly empty.

An empty list is a valid result, not a broken setup. Confirm the run is green
before concluding anything.

## What to do with the first alerts

Do **not** hand the whole list to an agent to fix. Triage first:

- **Real and reachable** → becomes a finding, sequenced with the existing audit
  backlog. It does not jump the queue just because a scanner found it.
- **False positive** → dismiss *with a written reason*. An undocumented dismissal
  is indistinguishable from someone hiding an alert.

Expect overlap with the 2026-09-18 audit. Where CodeQL and the audit describe
the same defect, the audit entry is the record — it has the file, the line and
the failure scenario already worked out. Do not open a duplicate.

Two specific predictions, so they are not mistaken for new discoveries:

- Anything CodeQL says about `next` / AVIF image handling is already **P1-32**.
- Anything about redirect handling in `lib/auth-routes.ts` is already **P1-13**.

## Why the query suite stays on default

`security-extended` roughly doubles the alert count, and most of the additions
are low-confidence on a codebase that has never been scanned. Establish a clean
baseline on the default suite first; widening the net before the first pass is
triaged just buries the real findings.

## After remediation

Once the P0/P1 work lands, re-check the code scanning list. Alerts that vanish
without anyone targeting them are the useful signal — they indicate the fix
closed a class of problem rather than one instance of it.
