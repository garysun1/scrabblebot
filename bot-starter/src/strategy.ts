// Strategy: value a rack, bid the marginal value of each letter, and decide
// which words to cash in.
//
// Rules that drive the design (from the module source):
//  * Score only comes from words; cash is just a means. Leftover cash and
//    leftover tiles are both worth nothing at the end.
//  * No rack limit, so hoarding toward 7+ letter words (3x) is free apart
//    from cash flow.
//  * Unbid tiles are discarded, so the match is exactly
//    98 - players*startingRack auctions; `bagTotal` tells us how many remain.
//  * The match ends the instant the last auction closes: a letter won in the
//    last auction can never be played, and words must be in before then.
//
// V(rack) = max over sets of disjoint words of
//             sum(reward(word)) + (1 - beta) * hoard(leftover tiles)
// where beta ramps 0 -> 1 as the bag empties (hoarded tiles stop having a
// future). A letter's bid is V(rack + letter) - V(rack), scaled by how much
// cash we have relative to what the rest of the match will cost.

import {
  BAG_COUNTS,
  Dict,
  FACE,
  type Rack,
  VOWEL,
  bestPartition,
  rackSize,
} from "./engine.js";

// Relative frequency of each letter in 7-8 letter words vs. in the bag
// (computed from the ENABLE list). >1 means the letter helps make bingos.
const FRIEND = [
  0.85, 1.13, 1.84, 1.0, 0.94, 0.76, 1.01, 1.2, 0.87, 0.23, 1.33, 1.4, 1.4, 0.99,
  0.76, 1.41, 0.2, 1.14, 2.19, 0.93, 0.92, 0.48, 0.57, 0.33, 0.85, 0.45,
];
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
  minBid: number; // bid at least this on any playable letter (tiles have no holding cost; reserve is 1)
  lateFillN: number; // in the last N auctions, don't let bids fall below lateFill if cash allows
  lateFill: number;
  earlyMult: number; // bid multiplier at match start...
  lateMult: number; // ...ramping linearly to this as the bag empties
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
  minMidLen: 7,
  starveCash: 19,
  allIn: 1,
  minBid: 1,
  lateFillN: 16,
  lateFill: 12,
  earlyMult: 1,
  lateMult: 1.4,
};

export interface View {
  rack: Rack;
  balance: number;
  bagLeft: number; // tiles still in the bag, not counting the open auction
  firstPrice: boolean;
  /** highest balance among opponents, if known (bids above it +1 buy nothing under Vickrey) */
  maxRivalBalance?: number;
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
    const gain = this.value(withL, after, candsWith) - this.value(v.rack, after, candsWithout);
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
    if (v.firstPrice) amt *= 0.6; // shade: we pay what we bid
    amt = Math.min(amt, v.balance * p.maxFrac + (v.bagLeft < 6 ? v.balance : 0));
    // Endgame fill: leftover cash is worthless, so any letter with positive
    // value is worth at least the going late price while we can afford it.
    if (v.bagLeft <= p.lateFillN && v.balance >= 2 * p.lateFill) amt = Math.max(amt, p.lateFill);
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
    return ws.filter((k) => this.dict.len[k] >= min);
  }
}

/** Bag composition helper (exported for the simulator/tests). */
export const BAG = BAG_COUNTS;
