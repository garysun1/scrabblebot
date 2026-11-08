// stem-potential variant of the v1 brain (src/strategy.ts).
//
// Change vs v1: the hand-written hoard() heuristic for leftover tiles is scaled
// by `hoardW` (1 = v1, 0 = removed) and the rack value gets a dictionary-derived
// "stem potential":
//
//   potential(R) = agg over 7-8 letter anagram classes within <= potMaxMiss
//                  missing tiles of R (and not already playable) of
//                  reward(class) x prod_{missing tile l} q(l)
//   q(l) = pWin x P(at least one more l is drawn from the bag)
//        = pWin x (1 - (1 - bagLeft/U)^unseen[l])      (U = total unseen tiles)
//
// agg = best + potAgg x (sum - best), then optionally saturated:
// S x (1 - exp(-raw/S)). A letter's bid uses
//   gain = [partition(R+L) - partition(R)] + potW x fade x [potential(R+L) - potential(R)]
// where both potentials come from ONE dictionary scan over the rack R+L.
//
// Everything else (kappa, cash factor, market floor, late fill, all-in, words())
// is identical to v1.

import { readFileSync } from "node:fs";
import {
  BAG_COUNTS,
  Dict,
  FACE,
  type Rack,
  VOWEL,
  bestPartition,
  rackMask,
  rackSize,
} from "../../engine.js";

// Relative frequency of each letter in 7-8 letter words vs. in the bag
// (computed from the ENABLE list). >1 means the letter helps make bingos.
const FRIEND = [
  0.85, 1.13, 1.84, 1.0, 0.94, 0.76, 1.01, 1.2, 0.87, 0.23, 1.33, 1.4, 1.4, 0.99,
  0.76, 1.41, 0.2, 1.14, 2.19, 0.93, 0.92, 0.48, 0.57, 0.33, 0.85, 0.45,
];
// Market medians (winning bid per letter x phase) fitted from the live archive.
let MARKET_MED: number[][] | null = null;
function marketMedian(letter: number, bagLeft: number): number {
  if (!MARKET_MED) {
    try {
      const m = JSON.parse(readFileSync(new URL("../../market.json", import.meta.url), "utf8"));
      MARKET_MED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) =>
        (m.letters[c] as ({ medTop: number } | null)[]).map((r) => (r ? r.medTop : 10)),
      );
    } catch {
      MARKET_MED = Array.from({ length: 26 }, () => [10, 10, 10, 10, 10]);
    }
  }
  const done = 67 - bagLeft;
  const ph = Math.max(0, Math.min(4, Math.floor((done * 5) / 68)));
  return MARKET_MED[letter][ph];
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
  // ---- stem-potential additions ----
  potW: number; // weight of the stem potential in V (0 = off = v1)
  hoardW: number; // scale of the v1 hoard heuristic (1 = v1, 0 = replaced by potential)
  pWin: number; // chance we win one specific wanted tile when it is auctioned
  potAgg: number; // aggregate: 0 = max over near words, 1 = sum, between = blend
  potSat: number; // saturation scale S (points): pot = S(1-exp(-raw/S)); 0 = off
  potMinLen: number; // consider classes of this length...
  potMaxLen: number; // ...up to this length
  potMaxMiss: number; // at most this many missing tiles (1 or 2)
  potFade: number; // multiply potential by (1-beta)^potFade (0 = no fade)
  potMinBag: number; // no potential term when bagLeft (after this auction) < this
  potBucket: number; // 1 = group near-words by missing multiset (max reward per bucket x P(bucket)); 0 = per-word agg
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
  // stem potential (defaults = v1 behaviour; the sweep overrides them)
  potW: 0,
  hoardW: 1,
  pWin: 0.3,
  potAgg: 0.15,
  potSat: 0,
  potMinLen: 7,
  potMaxLen: 8,
  potMaxMiss: 2,
  potFade: 1,
  potMinBag: 3,
  potBucket: 1,
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
}

export class Brain {
  /** anagram classes with potMinLen <= len <= potMaxLen (reward-desc order) */
  longIdx: Int32Array;
  /** diagnostics: number of potPair scans and total ms */
  potCalls = 0;
  potMs = 0;

  constructor(
    public dict: Dict,
    public p: Params = DEFAULT_PARAMS,
  ) {
    const out: number[] = [];
    for (let j = 0; j < dict.n; j++) {
      const k = dict.order[j];
      const L = dict.len[k];
      if (L >= p.potMinLen && L <= p.potMaxLen) out.push(k);
    }
    this.longIdx = Int32Array.from(out);
  }

  beta(bagLeft: number): number {
    if (bagLeft <= this.p.flushAt) return 1;
    return Math.max(0, Math.min(1, 1 - (bagLeft - this.p.flushAt) / this.p.horizon));
  }

  /** Heuristic future value of tiles we keep (v1), scaled by hoardW. */
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
    return v * p.hoardW;
  }

  /** Best plan for this rack: which words to play and the total value. */
  plan(r: Rack, bagLeft: number, cands?: number[]) {
    const b = this.beta(bagLeft);
    const c = cands ?? this.dict.candidates(r);
    const left = b >= 1 || this.p.hoardW <= 0 ? () => 0 : (x: Rack) => (1 - b) * this.hoard(x);
    return bestPartition(this.dict, r, c, left, this.p.budget);
  }

  value(r: Rack, bagLeft: number, cands?: number[]): number {
    return this.plan(r, bagLeft, cands).score;
  }

  /** agg + saturation of a (best, sum) pair of near-word expected rewards. */
  aggregate(best: number, sum: number): number {
    const p = this.p;
    const raw = best + p.potAgg * (sum - best);
    if (p.potSat > 0) return p.potSat * (1 - Math.exp(-raw / p.potSat));
    return raw;
  }

  /**
   * Stem potential of rack `r` (which includes one `letter` tile just added)
   * and of `r` minus that tile, from one scan of the 7-8 letter classes.
   * Returns [pot(r), pot(r - letter)] (already aggregated/saturated).
   */
  potPair(r: Rack, letter: number, unseen: Rack, bagLeft: number): [number, number] {
    const p = this.p;
    const t0 = performance.now();
    const d = this.dict;
    const maxMiss = p.potMaxMiss;
    // Per-letter completion chances (first and second copy of a letter).
    let U = 0;
    for (let i = 0; i < 26; i++) U += Math.max(0, unseen[i]);
    const f = U > 0 ? Math.min(1, bagLeft / U) : 0; // chance a given unseen tile is in the bag (and so gets auctioned)
    const q1 = new Float64Array(26);
    const q2 = new Float64Array(26);
    for (let i = 0; i < 26; i++) {
      const u = Math.max(0, unseen[i]);
      q1[i] = u > 0 ? p.pWin * (1 - Math.pow(1 - f, u)) : 0;
      q2[i] = u > 1 ? p.pWin * (1 - Math.pow(1 - f, u - 1)) : 0;
    }
    const rm = rackMask(r);
    const c = d.counts;
    const idx = this.longIdx;
    const total = rackSize(r) + maxMiss;
    const rL = r[letter];
    let best1 = 0, sum1 = 0, best0 = 0, sum0 = 0;
    // bucket mode: max reward per missing-letter (26) / missing-pair (26x26, a<=b) bucket
    const bucket = p.potBucket > 0;
    const s1 = bucket ? new Float64Array(26) : null;
    const s0 = bucket ? new Float64Array(26) : null;
    const d1 = bucket ? new Float64Array(676) : null;
    const d0 = bucket ? new Float64Array(676) : null;
    for (let j = 0; j < idx.length; j++) {
      const k = idx[j];
      if (d.len[k] > total) continue;
      // letters we lack entirely: more than maxMiss distinct -> skip (cheap prefilter)
      let extra = d.mask[k] & ~rm;
      let distinct = 0;
      while (extra) {
        extra &= extra - 1;
        if (++distinct > maxMiss) break;
      }
      if (distinct > maxMiss) continue;
      const o = k * 26;
      let miss = 0;
      let pr = 1;
      let ok = true;
      let m1 = -1, m2 = -1; // missing letters (ascending; m1 === m2 for a double)
      for (let i = 0; i < 26; i++) {
        const need = c[o + i] - r[i];
        if (need > 0) {
          miss += need;
          if (miss > maxMiss) {
            ok = false;
            break;
          }
          pr *= q1[i];
          if (need > 1) pr *= q2[i];
          if (m1 < 0) m1 = i; else m2 = i;
          if (need > 1) m2 = i;
        }
      }
      if (!ok || pr <= 0) continue;
      const usesL = c[o + letter] >= rL && rL > 0; // the class needs the tile we just added
      const rew = d.rew[k];
      if (bucket) {
        if (miss === 1) { if (rew > s1![m1]) s1![m1] = rew; }
        else if (miss === 2) { const key = m1 * 26 + m2; if (rew > d1![key]) d1![key] = rew; }
        if (!usesL) {
          if (miss === 1) { if (rew > s0![m1]) s0![m1] = rew; }
          else if (miss === 2) { const key = m1 * 26 + m2; if (rew > d0![key]) d0![key] = rew; }
        } else if (miss === 0) {
          if (rew > s0![letter]) s0![letter] = rew;
        } else if (miss === 1) {
          const a = Math.min(m1, letter), b = Math.max(m1, letter);
          const key = a * 26 + b;
          if (rew > d0![key]) d0![key] = rew;
        }
        continue;
      }
      if (miss > 0) {
        const ev1 = rew * pr;
        sum1 += ev1;
        if (ev1 > best1) best1 = ev1;
        if (usesL) {
          if (miss + 1 <= maxMiss) {
            // without L one more tile is missing: the L itself
            const extraCopies = c[o + letter] - rL; // L copies already missing with r (0 here since usesL => need<=0... keep general)
            const qL = extraCopies > 0 ? q2[letter] : q1[letter];
            const ev0 = ev1 * qL;
            sum0 += ev0;
            if (ev0 > best0) best0 = ev0;
          }
        } else {
          sum0 += ev1;
          if (ev1 > best0) best0 = ev1;
        }
      } else if (usesL) {
        // playable with r (counted by the partition), near-miss (missing L) without it
        const ev0 = rew * q1[letter];
        sum0 += ev0;
        if (ev0 > best0) best0 = ev0;
      }
    }
    this.potCalls++;
    this.potMs += performance.now() - t0;
    if (bucket) {
      // E[reward] = sum over missing-multisets M of P(M) x best reward completable with M
      let raw1 = 0, raw0 = 0;
      for (let a = 0; a < 26; a++) {
        raw1 += q1[a] * s1![a];
        raw0 += q1[a] * s0![a];
        for (let b = a; b < 26; b++) {
          const pq = a === b ? q1[a] * q2[a] : q1[a] * q1[b];
          if (pq <= 0) continue;
          const key = a * 26 + b;
          raw1 += pq * d1![key];
          raw0 += pq * d0![key];
        }
      }
      return [this.aggregate(raw1, raw1), this.aggregate(raw0, raw0)];
    }
    return [this.aggregate(best1, sum1), this.aggregate(best0, sum0)];
  }

  /**
   * Expected extra points from long words containing `letter` that are
   * within two tiles of `rack` (v1 nearValue, kept for completeness; off by default).
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
          const avail = 1 - Math.pow(1 - u / 98, draws);
          pr *= this.p.nearQ * avail;
        }
      } else {
        continue;
      }
      const ev = this.dict.rew[k] * pr;
      if (ev > best) best = ev;
      breadth += pr;
    }
    return best * (1 + 0.15 * Math.log1p(breadth));
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
    // Stem potential: how much closer does L bring us to 7-8 letter words we can still complete?
    if (p.potW > 0 && v.unseen && after >= p.potMinBag) {
      const [pot1, pot0] = this.potPair(withL, letter, v.unseen, after);
      const fade = p.potFade > 0 ? Math.pow(1 - this.beta(after), p.potFade) : 1;
      gain += p.potW * fade * (pot1 - pot0);
    }
    if (p.nearW > 0 && FACE[letter] >= p.nearMinFace && v.unseen && v.bagLeft > 3) {
      gain += p.nearW * this.nearValue(withL, letter, v.unseen, v.bagLeft);
    }
    const cap = Math.min(v.balance, (v.maxRivalBalance ?? Infinity) + 1);
    if (gain <= 0) return Math.min(cap, p.minBid);
    if (v.bagLeft <= p.allIn && !v.firstPrice) return Math.max(0, Math.round(cap));

    const need = Math.max(10, v.bagLeft * p.spendPerAuction);
    const cash = Math.max(p.cashMin, Math.min(p.cashMax, Math.sqrt(v.balance / need)));
    const progress = Math.max(0, Math.min(1, 1 - v.bagLeft / 63));
    const ramp = p.earlyMult + (p.lateMult - p.earlyMult) * progress;
    let amt = gain * p.kappa * cash * ramp;
    if (FACE[letter] >= 5 && v.bagLeft > p.premiumUntil && !(letter === 16 && v.rack[20] === 0)) amt *= p.premiumMult;
    if (v.firstPrice) amt *= 0.6; // shade: we pay what we bid
    amt = Math.min(amt, v.balance * p.maxFrac + (v.bagLeft < 6 ? v.balance : 0));
    if (v.bagLeft <= p.lateFillN && v.balance >= 2 * p.lateFill) amt = Math.max(amt, p.lateFill);
    if (p.marketFloor > 0 && gain >= p.marketFloorMinGain) {
      const floor = p.marketFloor * marketMedian(letter, v.bagLeft);
      if (v.balance >= 2 * floor) amt = Math.max(amt, floor);
    }
    amt = Math.max(amt, p.minBid);
    return Math.max(0, Math.min(cap, Math.round(amt)));
  }

  /** Words (dictionary indices) to play right now. */
  words(v: View): number[] {
    if (rackSize(v.rack) < 2) return [];
    const ws = this.plan(v.rack, v.bagLeft).words;
    if (v.bagLeft <= this.p.flushAt) return ws;
    const min = v.balance < this.p.starveCash ? 5 : this.p.minMidLen;
    const r = this.p.midMinReward;
    return ws.filter((k) => this.dict.len[k] >= min || (r > 0 && this.dict.rew[k] >= r));
  }
}

/** Bag composition helper (exported for the simulator/tests). */
export const BAG = BAG_COUNTS;
