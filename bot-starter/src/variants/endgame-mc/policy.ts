// endgame-mc: exact-horizon Monte Carlo letter values for the last K auctions.
//
// In the last few auctions the unseen pool is small and the end is exactly
// known, so a letter's value can be estimated directly as
//   E_F[ P(rack + L + F) - P(rack + F) ]
// where F = the tiles we will still win in the remaining usable auctions
// (sampled without replacement from `State.unseen`, each won with probability
// egP) and P = exact best partition (no hoard heuristic: leftover tiles are
// worth 0 at the end). The bid converts points to coins either with v1's own
// kappa x cash x ramp (mode "kappa": isolates the value change) or with a
// budget-share rule that spends the whole balance over the remaining usable
// auctions (mode "share": bid = balance x v / (v + expected value of future
// wins)), which tends to all-in as the end nears. bagLeft <= 1 keeps v1's
// all-in (coins are worthless one auction later; see RESULT.md).
//
// Run:  REPLAY_POLICY=./variants/endgame-mc/policy.ts <tsx> src/replay.ts x 200 11 '{"egK":8}'
import { type Dict, type Rack, bestPartition } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "../../strategy.js";
import type { Policy } from "../../replay.js";

export interface EgParams {
  egK: number; // use the MC valuation when 2 <= bagLeft <= egK (0 = off -> pure v1)
  egP: number; // chance we win each remaining usable auction
  egN: number; // MC samples per decision
  egBudget: number; // partition search budget per sample
  egMode: "kappa" | "share"; // coin pricing, see header
  egMult: number; // multiplier on the MC bid
  egFloor: number; // late fill floor (coins) when balance >= 2 x floor (0 = off)
  egMarket: number; // 1 = keep v1's market-median floor in the endgame
  egMinV: number; // treat values below this as noise (bid minBid)
}

export const DEFAULT_EG: EgParams = {
  egK: 8,
  egP: 0.3,
  egN: 24,
  egBudget: 800,
  egMode: "kappa",
  egMult: 1,
  egFloor: 12,
  egMarket: 1,
  egMinV: 0.5,
};

export class EndgameBrain extends Brain {
  eg: EgParams;
  rnd: () => number;
  lastMs = 0;
  constructor(d: Dict, p: Params, eg: EgParams, rnd: () => number) {
    super(d, p);
    this.eg = eg;
    this.rnd = rnd;
  }

  /** Sample the tiles we win in the next `draws` auctions from `pool` (counts). */
  private sampleFuture(pool: number[], draws: number, out: Rack): number {
    // partial Fisher-Yates over the pool letter list, keep each with prob egP
    let n = 0;
    const m = pool.length;
    const take = Math.min(draws, m);
    for (let t = 0; t < take; t++) {
      const j = t + Math.floor(this.rnd() * (m - t));
      const tmp = pool[t];
      pool[t] = pool[j];
      pool[j] = tmp;
      if (this.rnd() < this.eg.egP) {
        out[pool[t]]++;
        n++;
      }
    }
    return n;
  }

  /** MC value of `letter` (points) and the mean per-letter value of future wins. */
  mcValue(s: State, letter: number): { v: number; vbar: number; nF: number } {
    const d = this.dict;
    const eg = this.eg;
    const draws = s.bagLeft - 1; // auctions after this one whose tile can still be played
    const pool: number[] = [];
    for (let i = 0; i < 26; i++) {
      let c = s.unseen[i];
      if (i === letter) c--; // the letter on the block is out of the bag already
      for (let t = 0; t < c; t++) pool.push(i);
    }
    const zero = () => 0;
    const base = bestPartition(d, s.rack, d.candidates(s.rack), zero, eg.egBudget).score;
    let sumG = 0;
    let sumF = 0;
    let nF = 0;
    const withF = new Int8Array(26);
    const withLF = new Int8Array(26);
    for (let it = 0; it < eg.egN; it++) {
      withF.set(s.rack);
      const n = draws > 0 ? this.sampleFuture(pool, draws, withF) : 0;
      nF += n;
      withLF.set(withF);
      withLF[letter]++;
      const cands = d.candidates(withLF);
      const pLF = bestPartition(d, withLF, cands, zero, eg.egBudget).score;
      const pF = n > 0 ? bestPartition(d, withF, d.filter(cands, withF), zero, eg.egBudget).score : base;
      sumG += pLF - pF;
      sumF += pF - base;
    }
    const v = sumG / eg.egN;
    const vbar = nF > 0 ? Math.max(0.5, sumF / nF) : Math.max(0.5, v);
    return { v, vbar, nF: nF / eg.egN };
  }

  bidState(s: State, letter: number): number {
    const eg = this.eg;
    const view = {
      rack: s.rack,
      balance: s.balance,
      bagLeft: s.bagLeft,
      firstPrice: s.firstPrice,
      maxRivalBalance: s.maxRivalBalance,
      unseen: s.unseen,
    };
    if (eg.egK <= 0 || s.bagLeft <= 1 || s.bagLeft > eg.egK || !s.unseen) return this.bid(view, letter);
    const t0 = performance.now();
    const p = this.p;
    const cap = Math.min(s.balance, (s.maxRivalBalance ?? Infinity) + 1);
    const { v, vbar } = this.mcValue(s, letter);
    let amt: number;
    if (v < eg.egMinV) {
      amt = p.minBid;
    } else {
      const future = s.bagLeft - 1;
      if (eg.egMode === "share") {
        // spend the whole balance over this and the remaining usable auctions,
        // in proportion to value: lambda (pts/coin) = (v + p*future*vbar) / balance
        const expectFuture = eg.egP * future * vbar;
        amt = (s.balance * v) / (v + expectFuture);
      } else {
        const need = Math.max(10, s.bagLeft * p.spendPerAuction);
        const cash = Math.max(p.cashMin, Math.min(p.cashMax, Math.sqrt(s.balance / need)));
        const progress = Math.max(0, Math.min(1, 1 - s.bagLeft / 63));
        const ramp = p.earlyMult + (p.lateMult - p.earlyMult) * progress;
        amt = v * p.kappa * cash * ramp;
      }
      amt *= eg.egMult;
      if (s.firstPrice) amt *= 0.6;
      if (eg.egFloor > 0 && s.balance >= 2 * eg.egFloor) amt = Math.max(amt, eg.egFloor);
      if (eg.egMarket > 0 && v >= p.marketFloorMinGain) {
        const floor = eg.egMarket * marketMedianLate(letter, s.bagLeft);
        if (s.balance >= 2 * floor) amt = Math.max(amt, floor);
      }
      amt = Math.max(amt, p.minBid);
    }
    this.lastMs = performance.now() - t0;
    return Math.max(0, Math.min(cap, Math.round(amt)));
  }
}

// v1's market median helper is module-private; re-read market.json the same way.
import { readFileSync } from "node:fs";
let MED: number[][] | null = null;
function marketMedianLate(letter: number, bagLeft: number): number {
  if (!MED) {
    try {
      const m = JSON.parse(readFileSync(new URL("../../market.json", import.meta.url), "utf8"));
      MED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) =>
        (m.letters[c] as ({ medTop: number } | null)[]).map((r) => (r ? r.medTop : 10)),
      );
    } catch {
      MED = Array.from({ length: 26 }, () => [10, 10, 10, 10, 10]);
    }
  }
  const done = 67 - bagLeft;
  const ph = Math.max(0, Math.min(4, Math.floor((done * 5) / 68)));
  return MED[letter][ph];
}

export function makePolicy(
  d: Dict,
  over: Partial<Params & EgParams>,
  rnd: () => number = Math.random,
): Policy & { letter: number; brain: EndgameBrain } {
  const eg: EgParams = { ...DEFAULT_EG };
  const pp: Partial<Params> = {};
  for (const [k, val] of Object.entries(over ?? {})) {
    if (k in DEFAULT_EG) (eg as unknown as Record<string, unknown>)[k] = val;
    else (pp as Record<string, unknown>)[k] = val;
  }
  const brain = new EndgameBrain(d, { ...DEFAULT_PARAMS, ...pp }, eg, rnd ?? Math.random);
  const pol = {
    brain,
    letter: 0,
    reset() {},
    bid(s: State) {
      return brain.bidState(s, pol.letter);
    },
    words(s: State) {
      return brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
    },
    observePrice(_s: State, _letter: number, _paid: number, _weWon: boolean) {},
  };
  return pol;
}
