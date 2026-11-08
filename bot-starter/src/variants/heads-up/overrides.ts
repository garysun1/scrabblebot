// Parameter overrides keyed by the number of rivals at the table.
// 6 seats (5 rivals) = the live tuning, untouched. Smaller tables (bracket
// 5/4/3-seat rounds and the heads-up final) get their own tweaks, because the
// market floor (6-seat medians), the late fill and the pace were all fitted
// to a 6-seat market and there is no archive for small tables.
import { DEFAULT_PARAMS, type Params } from "../../strategy.js";

export type Over = Partial<Params> & {
  // optional nested per-table overrides from the CLI json: {"r1":{...},"r2":{...},"r3":{...},"r4":{...}}
  r1?: Partial<Params>;
  r2?: Partial<Params>;
  r3?: Partial<Params>;
  r4?: Partial<Params>;
};

// Candidates tested in self-play (RESULT.md). ALL of them LOST the heads-up mirror
// match against the unmodified live brain, so none is enabled:
export const CANDIDATES = {
  // pace-up + denial kappa + win ties: runs dry, the patient default sweeps the late tiles
  PKM: { spendPerAuction: 1.3, cashMax: 3, kappa: 3.2, minBid: 2 } as Partial<Params>,
  P: { spendPerAuction: 1.3, cashMax: 3 } as Partial<Params>,
  // 6-seat market floor + late fill off: under-spends (70+ coins left), mirror wins contested tiles
  F0: { marketFloor: 0, lateFillN: 0 } as Partial<Params>,
  SLOW: { spendPerAuction: 3.5 } as Partial<Params>,
};
// Shipped: no small-table overrides -> the policy is the live bot at every table size.
export const SMALL_TABLE: Record<number, Partial<Params>> = {
  1: {},
  2: {},
  3: {},
  4: {},
};

/** Params for a table with `nRivals` opponents. `over` = CLI/json overrides (6-seat keys + r1..r4). */
export function paramsFor(nRivals: number, over: Over = {}): Params {
  const { r1, r2, r3, r4, ...six } = over;
  const nested: Record<number, Partial<Params> | undefined> = { 1: r1, 2: r2, 3: r3, 4: r4 };
  const base: Params = { ...DEFAULT_PARAMS, ...six };
  if (nRivals >= 5 || nRivals <= 0) return base;
  return { ...base, ...(SMALL_TABLE[nRivals] ?? {}), ...(nested[nRivals] ?? {}) };
}
