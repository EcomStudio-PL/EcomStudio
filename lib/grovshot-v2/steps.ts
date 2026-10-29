/**
 * GROVBASE SHOT V2 — where each unit of an order lives in ai_engine_step_runs
 * (client-safe, no logic). Positions per order; per-shot units use item
 * `shot * 5 + k` (k = the round, or the delivery attempt's slot).
 */
export const P = { validate: 1, card: 2, plan: 3, mirror: 4, round: 5, charge: 6, deliver: 7, mark: 8, settle: 9 } as const;

export const itemOf = (shot: number, k: number) => shot * 5 + k;
