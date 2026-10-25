/**
 * The ONE order in which the Generate bar names what blocks a click — the
 * first that applies wins, the rest are dealt with when it is gone:
 *
 *   1  unavailable  the tool itself cannot run (not configured, not offered)
 *   2  invalid      the form still needs something (photos, a prompt, a value)
 *   3  limit        the plan's limit of generations in progress is reached
 *   4  account      the account and its credits (Public Tools state: confirm
 *                   the address, the survey, a plan, a top-up)
 *
 * The tool before the form: no field fixes a tool that is down. The form
 * before the limit and the money: what the customer is in the middle of
 * comes first, and a limit frees itself while they finish it.
 */
export type BarReason = "unavailable" | "invalid" | "limit" | "account";

export function barPriority(has: { unavailable: boolean; invalid: boolean; limit: boolean }): BarReason {
  if (has.unavailable) return "unavailable";
  if (has.invalid) return "invalid";
  if (has.limit) return "limit";
  return "account";
}
