// Brain v2: Monte Carlo letter values, a solved coin price, and a market
// model fitted from the live archive.
//
// Letter value: V(rack) = E[ best word partition of rack + F ], where F is k
// tiles sampled from the unseen pool. A letter is worth V(rack+L) - V(rack),
// using the same draws on both sides so the sampling noise cancels.
//
// Bid: value / lambda. Lambda (points per coin) is solved by bisection so that
// bidding this way on every remaining auction spends the budget: balance plus
// a share of expected word income. Early in the match lambda is high and
// bids are modest; late it falls toward the floor and bids rise to the whole
// balance. Nothing is left over, which matters because leftover cash is zero
// score.
//
// Market: top-bid distribution per letter and match phase, log-normal with
// parameters fitted from ~450 competitive live matches (market.json), plus an
// online "heat" multiplier calibrated from clearing prices in this match.

import { readFileSync } from "node:fs";
import { BAG_COUNTS, Dict, FACE, type Rack, bestPartition, rackSize } from "./engine.js";

interface PhaseRow {
  n: number;
  nobid: number;
  mu: number;
  sigma: number;
  medTop: number;
  medSecond: number;
}
interface Market {
  phases: number;
  letters: Record<string, (PhaseRow | null)[]>;
}
const MARKET: Market = JSON.parse(
  readFileSync(new URL("./market.json", import.meta.url), "utf8"),
);
const LET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GROUP = FACE.map((f) => (f === 1 ? 0 : f <= 4 ? 1 : 2));

// Per-opponent bid models fitted from the public archive (see BOT.md):
// bid ~ p0: none; else LogNormal(market mu + off[group] + late*[phase>=3], sigma).
export interface BotModel {
  name: string;
  n: number;
  off: [number, number, number];
  late: number;
  sigma: number;
  p0: number;
}
function loadBots(): Record<string, BotModel> {
  const file = process.env.BOTS_FILE ?? new URL("./bots.json", import.meta.url);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
export const BOTS: Record<string, BotModel> = loadBots();
// An unmodeled rival: a typical individual seat relative to the max-of-6 market.
const GENERIC: BotModel = { name: "?", n: 0, off: [-0.55, -0.55, -0.5], late: 0.15, sigma: 0.5, p0: 0.15 };
const SHRINK_N = 400; // observations at which a bot's own fit gets half weight vs generic

export interface Params2 {
  samples: number; // futures per valuation (refined bid)
  quickSamples: number; // futures for the anchor bid / letter table
  kMax: number; // max future tiles sampled
  futureScale: number; // k = futureScale * expected wins
  incomeShare: number; // budget += incomeShare * expected word income
  lambdaScale: number; // final multiplier on the bid
  lambdaMin: number;
  lambdaMax: number;
  coinBonus: number; // playing now: reward * (1 + coinBonus * lambda)
  playMargin: number; // play only if it beats holding by this many points
  heatWeight: number; // EMA weight for price calibration
  flushAt: number; // bagLeft <= flushAt: dump the exact best partition
  allIn: number; // bagLeft <= allIn: whole balance on any useful letter
  budget: number; // partition search nodes
  minBid: number; // bid at least this if the letter has any value
  heat0: number; // prior price heat at match start (tonight's lobby runs ~1.45x the archive)
  useRivals: boolean; // compose the price model from the seated opponents
}

export const DEFAULT_PARAMS2: Params2 = {
  samples: 24,
  quickSamples: 8,
  kMax: 13,
  futureScale: 1.1,
  incomeShare: 0.47,
  lambdaScale: 1.4,
  lambdaMin: 0.03,
  lambdaMax: 4,
  coinBonus: 0.3,
  playMargin: 2.5,
  heatWeight: 0.12,
  flushAt: 1,
  allIn: 1,
  budget: 300,
  minBid: 1,
  heat0: 1.45,
  useRivals: true,
};

export interface State {
  rack: Rack;
  balance: number;
  bagLeft: number; // tiles still in the bag after the current auction's letter was drawn
  totalAuctions: number; // e.g. 68 for 6 seats
  unseen: Rack; // tiles not yet seen by us (bag + rivals' hidden tiles)
  firstPrice: boolean;
  maxRivalBalance?: number;
  heat: number; // price multiplier, 1 = as fitted
  /** seated opponents with their public balances; enables the per-opponent model */
  rivals?: { id: number; balance: number }[];
}

// ---------- normal helpers ----------
function erf(x: number): number {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

export class Brain2 {
  rnd: () => number = Math.random;
  constructor(
    public dict: Dict,
    public p: Params2 = DEFAULT_PARAMS2,
  ) {}

  // ---------- market ----------

  phase(s: State): number {
    const done = s.totalAuctions - s.bagLeft - 1;
    return Math.max(0, Math.min(MARKET.phases - 1, Math.floor((done * MARKET.phases) / s.totalAuctions)));
  }
  row(letter: number, ph: number): PhaseRow {
    const rows = MARKET.letters[LET[letter]];
    return rows[ph] ?? rows.find((r) => r) ?? { n: 0, nobid: 0.05, mu: Math.log(10), sigma: 0.4, medTop: 10, medSecond: 7 };
  }

  /** Expected Vickrey payment and win probability when bidding b for `letter`. */
  expectPay(s: State, letter: number, ph: number, b: number): { pay: number; pwin: number } {
    if (b < 1) return { pay: 0, pwin: 0 };
    if (this.p.useRivals && s.rivals && s.rivals.length > 0) return this.expectPayRivals(s, letter, ph, b);
    const r = this.row(letter, ph);
    const mu = r.mu + Math.log(s.heat);
    const sg = Math.max(0.15, r.sigma);
    const lb = Math.log(b);
    const pBelow = Phi((lb - mu) / sg); // rivals' top below our bid
    const eBelow = Math.exp(mu + (sg * sg) / 2) * Phi((lb - mu - sg * sg) / sg); // E[X; X<b]
    const pwin = r.nobid + (1 - r.nobid) * pBelow;
    const pay = r.nobid * 1 + (1 - r.nobid) * eBelow;
    return { pay, pwin };
  }

  /** Model for one seated rival: shrunk toward the generic seat when data is thin. */
  rivalModel(id: number): BotModel {
    const m = BOTS[String(id)];
    if (!m) return GENERIC;
    const w = m.n / (m.n + SHRINK_N);
    const mix = (a: number, g: number) => w * a + (1 - w) * g;
    return {
      name: m.name,
      n: m.n,
      off: [mix(m.off[0], GENERIC.off[0]), mix(m.off[1], GENERIC.off[1]), mix(m.off[2], GENERIC.off[2])],
      late: mix(m.late, GENERIC.late),
      sigma: Math.max(0.2, mix(m.sigma, GENERIC.sigma)),
      p0: Math.min(0.9, Math.max(0.01, mix(m.p0, GENERIC.p0))),
    };
  }

  /** CDF of the highest rival bid: product over seats, each truncated at its balance. */
  maxRivalCdf(s: State, letter: number, ph: number): (x: number) => number {
    const r = this.row(letter, ph);
    const base = r.mu + Math.log(s.heat);
    const g = GROUP[letter];
    const late = ph >= 3 ? 1 : 0;
    const seats = s.rivals!.map((rv) => {
      const m = this.rivalModel(rv.id);
      return { mu: base + m.off[g] + m.late * late, sg: m.sigma, p0: m.p0, bal: rv.balance };
    });
    return (x: number) => {
      // P(every rival's bid <= x)
      let p = 1;
      for (const st of seats) {
        if (st.bal <= 0) continue; // broke: can't bid
        if (x >= st.bal) continue; // can't exceed its balance
        const F = x < 1 ? 0 : Phi((Math.log(x + 0.5) - st.mu) / st.sg);
        p *= st.p0 + (1 - st.p0) * F;
      }
      return p;
    };
  }

  expectPayRivals(s: State, letter: number, ph: number, b: number): { pay: number; pwin: number } {
    const cdf = this.maxRivalCdf(s, letter, ph);
    const bi = Math.floor(b);
    // Vickrey: we win if max rival < b (ties split); we pay the max rival bid (reserve 1).
    let pay = 0;
    let prev = cdf(0); // P(nobody bids)
    pay += prev * 1;
    let pwin = prev;
    for (let x = 1; x < bi; x++) {
      const c = cdf(x);
      const pm = c - prev; // P(max rival == x)
      if (pm > 0) {
        pay += pm * x;
        pwin += pm;
      }
      prev = c;
    }
    const tie = Math.max(0, cdf(bi) - prev);
    pay += 0.5 * tie * bi;
    pwin += 0.5 * tie;
    return { pay, pwin };
  }

  // ---------- valuation ----------

  /** k future tiles sampled without replacement from the unseen pool. */
  sampleFuture(unseen: Rack, k: number): number[] {
    const pool = Int8Array.from(unseen);
    let total = 0;
    for (let i = 0; i < 26; i++) total += Math.max(0, pool[i]);
    const out: number[] = [];
    for (let n = 0; n < k && total > 0; n++) {
      let idx = Math.floor(this.rnd() * total);
      for (let i = 0; i < 26; i++) {
        const c = Math.max(0, pool[i]);
        if (idx < c) {
          pool[i]--;
          total--;
          out.push(i);
          break;
        }
        idx -= c;
      }
    }
    return out;
  }

  expectedWins(s: State): number {
    const remaining = s.bagLeft; // auctions after this one whose tile is playable
    if (remaining <= 0) return 0;
    const ph = this.phase(s);
    let price = 0;
    let w = 0;
    for (let i = 0; i < 26; i++) {
      const c = Math.max(0, s.unseen[i]);
      if (!c) continue;
      price += c * this.row(i, ph).medSecond * s.heat;
      w += c;
    }
    price = w ? price / w : 10;
    return Math.min(0.5 * remaining, s.balance / Math.max(3, price));
  }

  futureK(s: State): number {
    return Math.max(0, Math.min(this.p.kMax, s.bagLeft, Math.round(this.p.futureScale * this.expectedWins(s))));
  }

  /** Pure word-point value of a rack (exact best partition). */
  exact(r: Rack): number {
    if (rackSize(r) < 2) return 0;
    return bestPartition(this.dict, r, this.dict.candidates(r), () => 0, this.p.budget).wordScore;
  }

  /**
   * Values for several racks sharing the same futures. Each entry of `racks`
   * is evaluated as rack + F_s for every sample; returns the means.
   */
  valueMany(racks: Rack[], s: State, k: number, samples: number): number[] {
    const sums = new Array<number>(racks.length).fill(0);
    if (k <= 0 || samples <= 0) return racks.map((r) => this.exact(r));
    // Superset rack for one candidate scan per sample.
    const sup = new Int8Array(26);
    for (const r of racks) for (let i = 0; i < 26; i++) sup[i] = Math.max(sup[i], r[i]);
    for (let n = 0; n < samples; n++) {
      const F = this.sampleFuture(s.unseen, k);
      const supF = Int8Array.from(sup);
      for (const l of F) supF[l]++;
      const cands = this.dict.candidates(supF);
      racks.forEach((r, j) => {
        const rf = Int8Array.from(r);
        for (const l of F) rf[l]++;
        const c = this.dict.filter(cands, rf);
        sums[j] += bestPartition(this.dict, rf, c, () => 0, this.p.budget).wordScore;
      });
    }
    return sums.map((x) => x / samples);
  }

  /** Marginal value of `letter` in points, judged for the next auction. */
  letterValue(s: State, letter: number, samples: number): number {
    if (s.bagLeft <= 0) return 0;
    const withL = Int8Array.from(s.rack);
    withL[letter]++;
    const next: State = { ...s, bagLeft: s.bagLeft - 1 };
    const k = this.futureK(next);
    const [a, b] = this.valueMany([withL, s.rack], next, k, samples);
    return Math.max(0, a - b);
  }

  /** Values for all 26 letters (for the lambda solve), cheap sampling. */
  letterTable(s: State, samples: number): number[] {
    const out = new Array<number>(26).fill(0);
    if (s.bagLeft <= 0) return out;
    const next: State = { ...s, bagLeft: s.bagLeft - 1 };
    const k = this.futureK(next);
    let base = 0;
    const perL = new Array<number[]>(26);
    for (let i = 0; i < 26; i++) perL[i] = [];
    for (let n = 0; n < Math.max(1, samples); n++) {
      const F = k > 0 ? this.sampleFuture(s.unseen, k) : [];
      const rf = Int8Array.from(s.rack);
      for (const l of F) rf[l]++;
      const { idx, miss } = this.dict.candidatesPlusOne(rf);
      const have: number[] = [];
      for (let j = 0; j < idx.length; j++) {
        if (miss[j] < 0) have.push(idx[j]);
        else perL[miss[j]].push(idx[j]);
      }
      const b0 = bestPartition(this.dict, rf, have, () => 0, this.p.budget).wordScore;
      base += b0;
      for (let i = 0; i < 26; i++) {
        if (perL[i].length === 0) {
          out[i] += b0;
          continue;
        }
        const r1 = Int8Array.from(rf);
        r1[i]++;
        // Candidates for rack+L: those that fit already plus those missing only L,
        // merged in reward order.
        const merged = this.mergeByReward(have, perL[i]);
        out[i] += bestPartition(this.dict, r1, merged, () => 0, this.p.budget).wordScore;
        perL[i].length = 0;
      }
    }
    const S = Math.max(1, samples);
    this.rackValue = base / S;
    return out.map((x) => Math.max(0, x / S - base / S));
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

  // ---------- lambda ----------

  /** Expected spend over the remaining auctions if we bid table[L]/lambda. */
  projectedSpend(s: State, table: number[], lambda: number): number {
    const remaining = s.bagLeft + 1; // including the current auction
    let total = 0;
    for (let i = 0; i < 26; i++) total += Math.max(0, s.unseen[i]);
    if (!total) return 0;
    const ph = this.phase(s);
    const phMid = Math.min(MARKET.phases - 1, ph + (s.bagLeft > s.totalAuctions / 4 ? 1 : 0));
    let spend = 0;
    for (let i = 0; i < 26; i++) {
      const c = Math.max(0, s.unseen[i]);
      if (!c || table[i] <= 0) continue;
      const b = table[i] / lambda; // deliberately not capped at balance
      spend += (c / total) * remaining * this.expectPay(s, i, phMid, b).pay;
    }
    return spend;
  }

  budgetFor(s: State, rackValue: number): number {
    const frac = s.totalAuctions ? s.bagLeft / s.totalAuctions : 0;
    return s.balance + this.p.incomeShare * rackValue * frac;
  }

  solveLambda(s: State, table: number[], rackValue: number): number {
    const budget = this.budgetFor(s, rackValue);
    let lo = this.p.lambdaMin;
    let hi = this.p.lambdaMax;
    if (this.projectedSpend(s, table, lo) <= budget) return lo;
    if (this.projectedSpend(s, table, hi) >= budget) return hi;
    for (let it = 0; it < 30; it++) {
      const mid = Math.sqrt(lo * hi);
      if (this.projectedSpend(s, table, mid) > budget) lo = mid;
      else hi = mid;
    }
    return Math.sqrt(lo * hi);
  }

  // ---------- decisions ----------

  /** Cached per-match context the client refreshes between auctions. */
  lambda = 0.5;
  table: number[] = new Array(26).fill(0);
  rackValue = 0;

  /** Recompute the letter table and lambda (call between auctions). */
  refreshLambda(s: State) {
    if (s.bagLeft <= 0) return;
    // Big racks make partitions pricier; keep the refresh inside ~150ms.
    const n = rackSize(s.rack);
    const samples = n > 12 ? Math.max(3, Math.floor(this.p.quickSamples / 2)) : n > 8 ? Math.max(4, Math.floor((this.p.quickSamples * 3) / 4)) : this.p.quickSamples;
    const t = this.letterTable(s, samples); // also sets rackValue
    this.table = t;
    this.lambda = this.solveLambda(s, t, this.rackValue);
  }

  cap(s: State): number {
    return Math.max(0, Math.min(s.balance, (s.maxRivalBalance ?? Infinity) + 1));
  }

  /** Coins to bid given a letter value in points. */
  bidFor(s: State, letter: number, value: number): number {
    const cap = this.cap(s);
    if (s.bagLeft <= 0 || value <= 0 || cap <= 0) return 0;
    if (s.bagLeft <= this.p.allIn && !s.firstPrice) return Math.round(cap);
    let b = (value / this.lambda) * this.p.lambdaScale;
    if (s.firstPrice) {
      // Shade: maximise (value/lambda - b) * P(win).
      const ph = this.phase(s);
      let best = 0;
      let bestU = 0;
      const truthful = b;
      for (let x = 1; x <= Math.min(cap, Math.ceil(truthful)); x++) {
        const u = (truthful - x) * this.expectPay(s, letter, ph, x).pwin;
        if (u > bestU) {
          bestU = u;
          best = x;
        }
      }
      b = best;
    }
    b = Math.min(cap, Math.round(b));
    return b >= 1 ? b : value > 0.3 ? Math.min(cap, this.p.minBid) : 0;
  }

  /** Quick bid from the cached table (anchor). */
  quickBid(s: State, letter: number): number {
    return this.bidFor(s, letter, this.table[letter] ?? 0);
  }

  /** Refined bid with fresh samples. */
  bid(s: State, letter: number): number {
    if (s.bagLeft <= 0) return 0;
    const v = s.bagLeft <= 1 ? this.exactGain(s, letter) : this.letterValue(s, letter, this.p.samples);
    return this.bidFor(s, letter, v);
  }

  exactGain(s: State, letter: number): number {
    const withL = Int8Array.from(s.rack);
    withL[letter]++;
    return Math.max(0, this.exact(withL) - this.exact(s.rack));
  }

  /** Words to play now (dictionary indices). */
  words(s: State): number[] {
    if (rackSize(s.rack) < 2) return [];
    const plan = bestPartition(this.dict, s.rack, this.dict.candidates(s.rack), () => 0, this.p.budget);
    if (s.bagLeft <= this.p.flushAt) return plan.words;
    if (plan.words.length === 0) return [];
    // Candidates: the plan's words plus the top few single words by reward.
    const cands = this.dict.candidates(s.rack, 4).slice(0, 4);
    const set = new Set<number>([...plan.words, ...cands]);
    const list = [...set].sort((a, b) => this.dict.rew[b] - this.dict.rew[a]).slice(0, 5);
    if (list.length === 0) return [];
    const racks: Rack[] = [s.rack];
    for (const k of list) {
      const r = Int8Array.from(s.rack);
      const o = k * 26;
      for (let i = 0; i < 26; i++) r[i] -= this.dict.counts[o + i];
      racks.push(r);
    }
    const kf = this.futureK(s);
    const v = this.valueMany(racks, s, kf, Math.max(8, this.p.quickSamples));
    const hold = v[0];
    let bestK = -1;
    let bestGain = this.p.playMargin;
    list.forEach((k, j) => {
      const now = this.dict.rew[k] * (1 + this.p.coinBonus * this.lambda) + v[j + 1];
      if (now - hold > bestGain) {
        bestGain = now - hold;
        bestK = k;
      }
    });
    return bestK >= 0 ? [bestK] : [];
  }
}

/** Unseen pool = bag - our tiles (held+played) - auctioned letters - rivals' revealed hidden tiles. */
export function unseenPool(
  ourTiles: Rack,
  auctioned: Rack,
  rivalPlayed: Rack,
  rivalWon: Rack,
): Rack {
  const u = new Int8Array(26);
  for (let i = 0; i < 26; i++) {
    const hidden = Math.max(0, rivalPlayed[i] - rivalWon[i]);
    u[i] = Math.max(0, BAG_COUNTS[i] - ourTiles[i] - auctioned[i] - hidden);
  }
  return u;
}

export { FACE };
