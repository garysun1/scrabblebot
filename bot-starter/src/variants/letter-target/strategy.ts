// letter-target variant of the v1 brain (copy of src/strategy.ts, 2026-11-08).
// Two additions, both only touching the market floor:
//  (1) a target trajectory of letters won vs auctions elapsed. When we are
//      behind the trajectory the floor multiplier rises (and the gain
//      threshold for applying the floor drops); when ahead it relaxes.
//  (2) live price "heat": the policy keeps an EMA of paid / archive medSecond
//      for the letter+phase and the floor is scaled by it, so it tracks the
//      table's actual price level instead of the static archive median.
// Everything else is identical to src/strategy.ts.

import { readFileSync } from "node:fs";
import {
  BAG_COUNTS,
  Dict,
  FACE,
  type Rack,
  VOWEL,
  bestPartition,
  rackSize,
} from "../../engine.js";

// Relative frequency of each letter in 7-8 letter words vs. in the bag
// (computed from the ENABLE list). >1 means the letter helps make bingos.
const FRIEND = [
  0.85, 1.13, 1.84, 1.0, 0.94, 0.76, 1.01, 1.2, 0.87, 0.23, 1.33, 1.4, 1.4, 0.99,
  0.76, 1.41, 0.2, 1.14, 2.19, 0.93, 0.92, 0.48, 0.57, 0.33, 0.85, 0.45,
];
// Market medians (winning bid / price paid per letter x phase) from the live archive.
let MARKET_MED: number[][] | null = null;
let MARKET_SEC: number[][] | null = null;
function loadMarket() {
  if (MARKET_MED && MARKET_SEC) return;
  const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  try {
    const m = JSON.parse(readFileSync(new URL("../../market.json", import.meta.url), "utf8"));
    type Row = { medTop: number; medSecond: number } | null;
    MARKET_MED = L.map((c) => (m.letters[c] as Row[]).map((r) => (r ? r.medTop : 10)));
    MARKET_SEC = L.map((c) => (m.letters[c] as Row[]).map((r) => (r && r.medSecond ? r.medSecond : 7)));
  } catch {
    MARKET_MED = Array.from({ length: 26 }, () => [10, 10, 10, 10, 10]);
    MARKET_SEC = Array.from({ length: 26 }, () => [7, 7, 7, 7, 7]);
  }
}
function phaseOf(bagLeft: number, total = 68): number {
  const done = total - 1 - bagLeft;
  return Math.max(0, Math.min(4, Math.floor((done * 5) / total)));
}
export function marketMedian(letter: number, bagLeft: number, total = 68): number {
  loadMarket();
  return MARKET_MED![letter][phaseOf(bagLeft, total)];
}
export function marketSecond(letter: number, bagLeft: number, total = 68): number {
  loadMarket();
  return MARKET_SEC![letter][phaseOf(bagLeft, total)];
}

const DUP_CAP = "AEIONRSTL".split("").map((c) => c.charCodeAt(0) - 65);

export interface Params {
  alpha: number; // hoard value per face point of a kept tile (early game)
  friend: number; // bonus per unit of bingo-friendliness
  base: number; // flat value of any kept tile (it's a future word slot)
  dupPen: number; // penalty per tile beyond the duplicate cap
  vowelPen: number; // penalty per tile of vowel/consonant imbalance
  horizon: number; // beta reaches 1 when this many auctions remain... scaled
  flushAt: number; // bagLeft <= flushAt -> play the final partition
  kappa: number; // coins per point of marginal value
  spendPerAuction: number; // expected spend per remaining auction
  cashMin: number; // clamp for cash factor
  cashMax: number;
  maxFrac: number; // never bid more than this fraction of balance
  budget: number; // partition search nodes
  faceFriend: number; // 0..1: how much bingo-friendliness scales a tile's face value
  minMidLen: number; // mid-match, only cash words at least this long...
  starveCash: number; // ...unless balance is below this (then 5+ letters)
  allIn: number; // go all-in on useful letters when bagLeft <= this
  nearW: number; // weight of the near-complete-long-word value for premium letters (0 = off)
  nearQ: number; // chance we end up with one specific missing tile
  nearMinFace: number; // apply to letters with face >= this
  premiumMult: number; // bid multiplier on 5+ point letters (K J X Q Z) while bagLeft > premiumUntil
  premiumUntil: number;
  marketFloor: number; // bid at least this fraction of the market median on letters with positive value (0 = off)
  marketFloorMinGain: number; // ...when the letter's marginal value is at least this
  midMinReward: number; // mid-match, also cash shorter words worth at least this many points (0 = off)
  minBid: number; // bid at least this on any playable letter (tiles have no holding cost; reserve is 1)
  lateFillN: number; // in the last N auctions, don't let bids fall below lateFill if cash allows
  lateFill: number;
  earlyMult: number; // bid multiplier at match start...
  lateMult: number; // ...ramping linearly to this as the bag empties
  // --- letter-target additions ---
  tgtLetters: number; // target letters won by the end of the match (0 = off)
  tgtExp: number; // trajectory shape: target(x) = tgtLetters * x^tgtExp (1 linear, <1 front-loaded, >1 back-loaded)
  tgtSlope: number; // floor multiplier change per letter of deficit (target - won)
  floorBehind: number; // cap on the floor multiplier when behind
  floorAhead: number; // cap on the floor multiplier when ahead
  minGainBehind: number; // when behind, the floor applies to letters with marginal value >= this
  heat0: number; // prior price heat (1 = archive median)
  heatW: number; // EMA weight for live price calibration (0 = off, static archive)
  heatMin: number; // clamps on the heat used in the floor
  heatMax: number;
}

export const DEFAULT_PARAMS: Params = {
  // Cross-entropy search against replays of HackUTD-only tables (src/optimize.ts,
  // 2026-11-07), validated on a held-out split and on strong-table replays.
  alpha: 1.19,
  friend: 0.6,
  base: 3.2,
  dupPen: 1.7,
  vowelPen: 2.7,
  horizon: 16,
  flushAt: 1,
  kappa: 2.4,
  spendPerAuction: 2.26,
  cashMin: 0.5,
  cashMax: 2.45,
  maxFrac: 1.0,
  budget: 3000,
  faceFriend: 0.53,
  minMidLen: 99, // hold everything (a 7 can grow into an 8); cash only when starved or at the flush
  starveCash: 20,
  allIn: 1,
  nearW: 0,
  nearQ: 0.3,
  nearMinFace: 5,
  premiumMult: 1,
  premiumUntil: 15,
  marketFloor: 1.0,
  marketFloorMinGain: 2,
  midMinReward: 0,
  minBid: 1,
  lateFillN: 16,
  lateFill: 12,
  earlyMult: 1,
  lateMult: 1.4,
  // letter-target additions: defaults reproduce v1 exactly (both off)
  tgtLetters: 0,
  tgtExp: 1,
  tgtSlope: 0.2,
  floorBehind: 1.3,
  floorAhead: 0.8,
  minGainBehind: 0,
  heat0: 1,
  heatW: 0,
  heatMin: 0.6,
  heatMax: 1.8,
};

export interface View {
  rack: Rack;
  balance: number;
  bagLeft: number; // tiles still in the bag, not counting the open auction
  firstPrice: boolean;
  /** highest balance among opponents, if known (bids above it +1 buy nothing under Vickrey) */
  maxRivalBalance?: number;
  /** tiles not yet seen (bag + rivals' hidden tiles); enables the near-word valuation */
  unseen?: Rack;
  /** letters we have won so far in this match (tracked by the policy from auction results) */
  won?: number;
  /** 0-based index of the current auction and the match's auction count */
  auctionIndex?: number;
  totalAuctions?: number;
  /** live price heat: EMA of paid / archive medSecond (1 = archive level) */
  heat?: number;
}

export class Brain {
  constructor(
    public dict: Dict,
    public p: Params = DEFAULT_PARAMS,
  ) {}

  beta(bagLeft: number): number {
    if (bagLeft <= this.p.flushAt) return 1;
    return Math.max(0, Math.min(1, 1 - (bagLeft - this.p.flushAt) / this.p.horizon));
  }

  /** Heuristic future value of tiles we keep. */
  hoard(r: Rack): number {
    const p = this.p;
    let v = 0;
    let vow = 0;
    let n = 0;
    for (let i = 0; i < 26; i++) {
      const c = r[i];
      if (c <= 0) continue;
      n += c;
      if (VOWEL[i]) vow += c;
      const cap = DUP_CAP.includes(i) ? 2 : 1;
      const fscale = 1 - p.faceFriend + p.faceFriend * Math.min(FRIEND[i], 1.5);
      const each = FACE[i] * p.alpha * fscale + p.base + p.friend * (FRIEND[i] - 1);
      const keep = Math.min(c, cap);
      v += keep * each + (c - keep) * (each * 0.5 - p.dupPen);
    }
    if (n > 0) {
      const ideal = 0.42 * n;
      const off = Math.abs(vow - ideal);
      v -= p.vowelPen * Math.max(0, off - 1) ** 1.5;
    }
    // Q without U is nearly dead weight.
    if (r[16] > 0 && r[20] === 0) v -= FACE[16] * p.alpha * 0.6;
    return v;
  }

  /** Best plan for this rack: which words to play and the total value. */
  plan(r: Rack, bagLeft: number, cands?: number[]) {
    const b = this.beta(bagLeft);
    const c = cands ?? this.dict.candidates(r);
    const left = b >= 1 ? () => 0 : (x: Rack) => (1 - b) * this.hoard(x);
    return bestPartition(this.dict, r, c, left, this.p.budget);
  }

  value(r: Rack, bagLeft: number, cands?: number[]): number {
    return this.plan(r, bagLeft, cands).score;
  }

  /**
   * Expected extra points from long words containing `letter` that are
   * within two tiles of `rack`: for each such word, reward x the chance we
   * get the missing tiles (nearQ each, scaled by how many of that letter
   * remain unseen). Words overlap, so take the best plus a small bonus for
   * breadth.
   */
  nearValue(rack: Rack, letter: number, unseen: Rack, bagLeft: number): number {
    const { idx, missLetters } = this.dict.nearWords(rack, letter, 2, 7);
    if (idx.length === 0) return 0;
    const draws = Math.min(bagLeft, 30);
    let best = 0;
    let breadth = 0;
    for (let j = 0; j < idx.length; j++) {
      const k = idx[j];
      const already = this.dict.fits(k, rack);
      let pr = 1;
      if (!already) {
        for (const l of missLetters[j]) {
          const u = Math.max(0, unseen[l]);
          // chance this letter is drawn in the auctions left, times chance we win it
          const avail = 1 - Math.pow(1 - u / 98, draws);
          pr *= this.p.nearQ * avail;
        }
      } else {
        continue; // already playable: counted by the partition value
      }
      const ev = this.dict.rew[k] * pr;
      if (ev > best) best = ev;
      breadth += pr;
    }
    return best * (1 + 0.15 * Math.log1p(breadth));
  }

  /**
   * Floor multiplier and gain threshold for this auction, from the letter
   * target trajectory. Returns v1's static values when the target is off.
   */
  floorPolicy(v: View): { mult: number; minGain: number; deficit: number } {
    const p = this.p;
    let mult = p.marketFloor;
    let minGain = p.marketFloorMinGain;
    let deficit = 0;
    if (p.tgtLetters > 0 && v.auctionIndex !== undefined && v.won !== undefined) {
      const total = v.totalAuctions ?? 68;
      const x = Math.max(0, Math.min(1, v.auctionIndex / Math.max(1, total - 1)));
      const target = p.tgtLetters * Math.pow(x, p.tgtExp);
      deficit = target - v.won;
      mult *= Math.max(p.floorAhead, Math.min(p.floorBehind, 1 + p.tgtSlope * deficit));
      if (deficit > 0) minGain = p.minGainBehind;
    }
    return { mult, minGain, deficit };
  }

  /** Coins to bid for `letter` (0..25). */
  bid(v: View, letter: number): number {
    // The last auction's letter can never be played.
    if (v.bagLeft <= 0) return 0;
    const p = this.p;
    // Value is judged as of the next auction, when the tile would arrive.
    const after = v.bagLeft - 1;
    const withL = Int8Array.from(v.rack);
    withL[letter]++;
    const candsWith = this.dict.candidates(withL);
    const candsWithout = this.dict.filter(candsWith, v.rack);
    let gain = this.value(withL, after, candsWith) - this.value(v.rack, after, candsWithout);
    // Premium letters: the leaders buy a Z when a 7-letter Z-word is within
    // reach of their rack and the unseen tiles. Value that explicitly.
    if (p.nearW > 0 && FACE[letter] >= p.nearMinFace && v.unseen && v.bagLeft > 3) {
      gain += p.nearW * this.nearValue(withL, letter, v.unseen, v.bagLeft);
    }
    const cap = Math.min(v.balance, (v.maxRivalBalance ?? Infinity) + 1);
    if (gain <= 0) return Math.min(cap, p.minBid);
    // Last usable auction: cash is worthless one auction from now and the tile
    // still counts in the final flush, so spend it all (both public
    // tournament bots converged on this).
    if (v.bagLeft <= p.allIn && !v.firstPrice) return Math.max(0, Math.round(cap));

    const need = Math.max(10, v.bagLeft * p.spendPerAuction);
    const cash = Math.max(p.cashMin, Math.min(p.cashMax, Math.sqrt(v.balance / need)));
    // Top live bots bid low early and ~1.75x higher late, when unspent cash
    // is about to become worthless.
    const progress = Math.max(0, Math.min(1, 1 - v.bagLeft / 63));
    const ramp = p.earlyMult + (p.lateMult - p.earlyMult) * progress;
    let amt = gain * p.kappa * cash * ramp;
    if (FACE[letter] >= 5 && v.bagLeft > p.premiumUntil && !(letter === 16 && v.rack[20] === 0)) amt *= p.premiumMult;
    if (v.firstPrice) amt *= 0.6; // shade: we pay what we bid
    amt = Math.min(amt, v.balance * p.maxFrac + (v.bagLeft < 6 ? v.balance : 0));
    // Endgame fill: leftover cash is worthless, so any letter with positive
    // value is worth at least the going late price while we can afford it.
    if (v.bagLeft <= p.lateFillN && v.balance >= 2 * p.lateFill) amt = Math.max(amt, p.lateFill);
    if (p.marketFloor > 0) {
      const { mult, minGain } = this.floorPolicy(v);
      if (gain >= minGain) {
        const heat = Math.max(p.heatMin, Math.min(p.heatMax, v.heat ?? 1));
        const floor = mult * heat * marketMedian(letter, v.bagLeft, v.totalAuctions ?? 68);
        if (v.balance >= 2 * floor) amt = Math.max(amt, floor);
      }
    }
    amt = Math.max(amt, p.minBid);
    return Math.max(0, Math.min(cap, Math.round(amt)));
  }

  /** Words (dictionary indices) to play right now. */
  words(v: View): number[] {
    if (rackSize(v.rack) < 2) return [];
    const ws = this.plan(v.rack, v.bagLeft).words;
    if (v.bagLeft <= this.p.flushAt) return ws;
    // Mid-match, hold short words: the top live bots score ~85% of their
    // points from 7+ letter words. Cash shorter ones only when starved.
    const min = v.balance < this.p.starveCash ? 5 : this.p.minMidLen;
    const r = this.p.midMinReward;
    return ws.filter((k) => this.dict.len[k] >= min || (r > 0 && this.dict.rew[k] >= r));
  }
}

/** Bag composition helper (exported for the simulator/tests). */
export const BAG = BAG_COUNTS;
