# ADR-0002 No service-role key in the application
Decision: every server query runs under the caller's JWT; privileged
operations go through audited definer RPCs.
Why: a leaked app secret can never bypass RLS; IDOR class collapses to
"RLS must be right", which advisors + audits verify.
Consequence: some admin aggregates need SQL functions (e.g.
generation_credits_total). Reversal: easy technically, forbidden by policy.
