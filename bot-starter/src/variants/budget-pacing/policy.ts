// budget-pacing: keep v1's letter VALUES (its ranking of letters is good) but
// replace the bid scaling (kappa x cash factor x late ramp) with a
// budget-matched scale, the way K-13 / the Rust bot pace their spend.
//
// Each auction (every `every` auctions) we compute v1's marginal value gain(L)
// for all 26 letters, then solve for a multiplier m such that the projected
// spend over the remaining auctions -- bidding gain(L) x m on every letter L,
// weighted by the unseen pool, paying the market's expected Vickrey price --
// equals balance + incomeShare x (cashable word points) x (fraction of match
// left). Bid = gain x m x mScale, then the existing v1 floors/caps/all-in.
//
// Run:  REPLAY_POLICY=./variants/budget-pacing/policy.ts <tsx> src/replay.ts x 200 11 '{"incomeShare":0.5}'
import { bestPartition, rackSize, type Dict, type Rack } from "../../engine.js";
import { Brain2, DEFAULT_PARAMS2, type State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "../../strategy.js";
import type { Policy } from "../../replay.js";

export interface BPParams extends Params {
  incomeShare: number; // budget += incomeShare x cashable word points x (bagLeft/totalAuctions)
  mScale: number; // multiplier on the solved m
  mMin: number; // bounds on m (coins per point of v1 value)
  mMax: number;
  every: number; // refresh the 26-letter table / m every N auctions
  tableBudget: number; // partition nodes per letter for the table
  tableBudgetBig: number; // ...on racks of more than 18 tiles
  heat0: number; // prior price heat (paid / archive medSecond)
  heatWeight: number; // EMA weight of the live heat
  useRivals: boolean; // per-opponent price model for the projection (false = market only)
  fixedIncome: number; // if > 0, use this instead of the rack's cashable points (sweep knob)
}

export const BP_DEFAULTS: BPParams = {
  ...DEFAULT_PARAMS,
  incomeShare: 0.5,
  mScale: 1.0,
  mMin: 0.5,
  mMax: 12,
  every: 2,
  tableBudget: 800,
  tableBudgetBig: 400,
  heat0: 1.45,
  heatWeight: 0.12,
  useRivals: false,
  fixedIncome: 0,
};

export class BudgetPacer {
  brain: Brain;
  b2: Brain2;
  heat: number;
  m = 2.4;
  since = 99;
  table: number[] = new Array(26).fill(0);
  lastM = 0;
  constructor(
    public dict: Dict,
    public p: BPParams,
  ) {
    this.brain = new Brain(dict, p);
    this.b2 = new Brain2(dict, { ...DEFAULT_PARAMS2, useRivals: p.useRivals });
    this.heat = p.heat0;
  }

  reset() {
    this.heat = this.p.heat0;
    this.since = 99;
    this.m = 2.4;
  }

  private mergeByReward(a: number[], b: number[]): number[] {
    const out: number[] = [];
    let i = 0;
    let j = 0;
    const rew = this.dict.rew;
    while (i < a.length || j < b.length) {
      if (j >= b.length || (i < a.length && rew[a[i]] >= rew[b[j]])) out.push(a[i++]);
      else out.push(b[j++]);
    }
    return out;
  }

  /** v1 marginal value for all 26 letters (one candidate scan), plus cashable word points. */
  letterTable(s: State): { table: number[]; income: number } {
    const after = s.bagLeft - 1;
    const b = this.brain.beta(after);
    const left = b >= 1 ? () => 0 : (x: Rack) => (1 - b) * this.brain.hoard(x);
    const { idx, miss } = this.dict.candidatesPlusOne(s.rack);
    const have: number[] = [];
    const perL: number[][] = Array.from({ length: 26 }, () => []);
    for (let j = 0; j < idx.length; j++) {
      if (miss[j] < 0) have.push(idx[j]);
      else perL[miss[j]].push(idx[j]);
    }
    // Big racks make partitions pricier; keep the 26-letter table inside the budget.
    const bud = rackSize(s.rack) > 18 ? this.p.tableBudgetBig : this.p.tableBudget;
    const basePart = bestPartition(this.dict, s.rack, have, left, bud);
    const base = basePart.score;
    const income = b >= 1 ? basePart.wordScore : bestPartition(this.dict, s.rack, have, () => 0, bud).wordScore;
    const table = new Array<number>(26).fill(0);
    for (let i = 0; i < 26; i++) {
      if (s.unseen[i] <= 0) continue;
      const r1 = Int8Array.from(s.rack);
      r1[i]++;
      const merged = perL[i].length ? this.mergeByReward(have, perL[i]) : have;
      table[i] = Math.max(0, bestPartition(this.dict, r1, merged, left, bud).score - base);
    }
    return { table, income };
  }

  /** Expected spend over the remaining auctions if we bid table[L] x m. */
  spend(s: State, table: number[], m: number): number {
    return this.b2.projectedSpend(s, table, 1 / m);
  }

  solveM(s: State, table: number[], income: number): number {
    const p = this.p;
    const frac = s.totalAuctions ? s.bagLeft / s.totalAuctions : 0;
    const inc = p.fixedIncome > 0 ? p.fixedIncome : income;
    const budget = s.balance + p.incomeShare * inc * frac;
    let lo = p.mMin;
    let hi = p.mMax;
    if (this.spend(s, table, lo) >= budget) return lo;
    if (this.spend(s, table, hi) <= budget) return hi;
    for (let it = 0; it < 24; it++) {
      const mid = Math.sqrt(lo * hi);
      if (this.spend(s, table, mid) > budget) hi = mid;
      else lo = mid;
    }
    return Math.sqrt(lo * hi);
  }

  refresh(s: State) {
    const { table, income } = this.letterTable(s);
    this.table = table;
    this.m = this.solveM(s, table, income);
    this.lastM = this.m;
  }

  bid(s: State, letter: number): number {
    if (s.bagLeft <= 0) return 0;
    const p = this.p;
    const brain = this.brain;
    s.heat = this.heat;
    const after = s.bagLeft - 1;
    const withL = Int8Array.from(s.rack);
    withL[letter]++;
    const candsWith = this.dict.candidates(withL);
    const candsWithout = this.dict.filter(candsWith, s.rack);
    const gain = brain.value(withL, after, candsWith) - brain.value(s.rack, after, candsWithout);
    const cap = Math.min(s.balance, (s.maxRivalBalance ?? Infinity) + 1);
    if (gain <= 0) return Math.max(0, Math.min(cap, p.minBid));
    if (s.bagLeft <= p.allIn && !s.firstPrice) return Math.max(0, Math.round(cap));

    if (this.since >= p.every) {
      this.refresh(s);
      this.since = 0;
    }
    this.since++;

    let amt = gain * this.m * p.mScale;
    if (s.firstPrice) amt *= 0.6;
    amt = Math.min(amt, s.balance * p.maxFrac + (s.bagLeft < 6 ? s.balance : 0));
    if (s.bagLeft <= p.lateFillN && s.balance >= 2 * p.lateFill) amt = Math.max(amt, p.lateFill);
    if (p.marketFloor > 0 && gain >= p.marketFloorMinGain) {
      const floor = p.marketFloor * this.b2.row(letter, this.b2.phase(s)).medTop;
      if (s.balance >= 2 * floor) amt = Math.max(amt, floor);
    }
    amt = Math.max(amt, p.minBid);
    return Math.max(0, Math.min(cap, Math.round(amt)));
  }

  words(s: State): number[] {
    return this.brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
  }

  observePrice(s: State, letter: number, paid: number) {
    if (paid <= 0) return;
    const ref = this.b2.row(letter, this.b2.phase(s)).medSecond || 7;
    const ratio = Math.max(0.3, Math.min(3, paid / ref));
    this.heat = this.heat * (1 - this.p.heatWeight) + ratio * this.p.heatWeight;
  }
}

export function makePolicy(d: Dict, over: Partial<BPParams>, _rnd: () => number): Policy & { letter: number; pacer: BudgetPacer } {
  const pacer = new BudgetPacer(d, { ...BP_DEFAULTS, ...over });
  const pol = {
    letter: 0,
    pacer,
    reset() {
      pacer.reset();
    },
    bid(s: State) {
      return pacer.bid(s, pol.letter);
    },
    words(s: State) {
      return pacer.words(s);
    },
    observePrice(s: State, letter: number, paid: number, _weWon: boolean) {
      pacer.observePrice(s, letter, paid);
    },
  };
  return pol;
}
