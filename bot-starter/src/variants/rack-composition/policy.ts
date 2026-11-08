// Variant "rack-composition": replace / augment the hand-set hoard() with a
// dictionary-measured "completability" of the rack.
//
// completability(rack) = f( sum over 7..cMaxLen-letter anagram classes k within
//   cMaxMiss tiles of the rack of  rew[k] * prod_{missing letter m} cQ * avail(m) )
// where avail(m) = 1 - (1 - unseen[m]/98)^draws is the chance that a missing
// letter is still drawn (0 if none is unseen), cQ the chance we win it, and
// f = cw * log1p(.) (cMode 0), cw * sqrt(.) (1) or cw * (.) (2).
// One scan of the long classes per auction gives both the with-L and the
// without-L mass, so the marginal completability of the letter is cheap.
//
// gain(L) = partition gain (v1, hoard scaled by hoardMult) + (1-beta) * dC.
// Everything downstream (kappa, cash factor, floors, late fill, cap) is v1.
//
// Run: REPLAY_POLICY=./variants/rack-composition/policy.ts <tsx> src/replay.ts x 200 11 '{"cw":4}'
import { readFileSync } from "node:fs";
import { FACE, type Dict, type Rack, rackMask, rackSize } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "../../strategy.js";
import type { Policy } from "../../replay.js";

export interface CParams extends Params {
  cw: number; // weight of the completability term (0 = off = plain v1)
  cMode: number; // 0 log1p, 1 sqrt, 2 linear
  cQ: number; // chance we win a specific missing letter once it is drawn
  cMaxMiss: number; // count classes within this many missing tiles (1 or 2)
  cMinLen: number; // shortest word length that counts
  cMaxLen: number; // longest word length that counts
  cZero: number; // weight of already-complete long classes (they can still grow)
  cFade: number; // 1: fade dC with (1-beta) like the hoard; 0: no fade
  hoardMult: number; // multiplier on the v1 hoard (1 keep, 0 replace)
}

export const C_DEFAULTS: CParams = {
  ...DEFAULT_PARAMS,
  cw: 0,
  cMode: 0,
  cQ: 0.3,
  cMaxMiss: 2,
  cMinLen: 7,
  cMaxLen: 8,
  cZero: 0,
  cFade: 1,
  hoardMult: 1,
};

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

export class CBrain extends Brain {
  cp: CParams;
  longIdx: Int32Array; // classes with cMinLen <= len <= cMaxLen, reward-desc
  lastScan = 0; // classes surviving the mask prefilter in the last scan (for timing/debug)

  constructor(dict: Dict, cp: CParams) {
    super(dict, cp);
    this.cp = cp;
    const ids: number[] = [];
    for (let j = 0; j < dict.n; j++) {
      const k = dict.order[j];
      const L = dict.len[k];
      if (L >= cp.cMinLen && L <= cp.cMaxLen) ids.push(k);
    }
    this.longIdx = Int32Array.from(ids);
  }

  hoard(r: Rack): number {
    const m = this.cp.hoardMult;
    if (m === 0) return 0;
    return m * super.hoard(r);
  }

  private f(mass: number): number {
    const cp = this.cp;
    if (cp.cMode === 1) return cp.cw * Math.sqrt(mass);
    if (cp.cMode === 2) return cp.cw * mass;
    return cp.cw * Math.log1p(mass);
  }

  /**
   * Completability of rack+letter and of rack alone, from one scan.
   * Returns [C(rack+L), C(rack)].
   */
  completability(rack: Rack, letter: number, unseen: Rack, bagLeft: number): [number, number] {
    const cp = this.cp;
    const d = this.dict;
    const withL = Int8Array.from(rack);
    withL[letter]++;
    const total = rackSize(withL);
    const rm = rackMask(withL);
    const maxMiss = cp.cMaxMiss;
    const draws = Math.min(bagLeft, 30);
    const av = new Float64Array(26);
    for (let i = 0; i < 26; i++) {
      const u = Math.max(0, unseen[i]);
      av[i] = u > 0 ? cp.cQ * (1 - Math.pow(1 - u / 98, draws)) : 0;
    }
    const avL = av[letter];
    const c = d.counts;
    const rew = d.rew;
    const len = d.len;
    const mask = d.mask;
    const rackL = rack[letter];
    let massW = 0;
    let massO = 0;
    let survivors = 0;
    const idx = this.longIdx;
    for (let j = 0; j < idx.length; j++) {
      const k = idx[j];
      if (len[k] > total + maxMiss) continue;
      let extra = mask[k] & ~rm;
      // distinct letters we lack entirely: more than maxMiss -> skip
      if (maxMiss <= 1) {
        if (extra & (extra - 1)) continue;
      } else {
        extra &= extra - 1;
        if (extra & (extra - 1)) continue;
      }
      survivors++;
      const o = k * 26;
      let miss = 0;
      let pr = 1;
      for (let i = 0; i < 26; i++) {
        const need = c[o + i] - withL[i];
        if (need > 0) {
          miss += need;
          if (miss > maxMiss) break;
          pr *= need === 1 ? av[i] : av[i] * av[i];
        }
      }
      if (miss > maxMiss) continue;
      const r = rew[k];
      massW += r * (miss === 0 ? cp.cZero : pr);
      if (c[o + letter] > rackL) {
        // this class uses the new L: without it one more tile is missing.
        // A class complete with L is gated by cZero on both sides (consistency).
        if (miss + 1 <= maxMiss) massO += r * pr * avL * (miss === 0 ? cp.cZero : 1);
      } else {
        massO += r * (miss === 0 ? cp.cZero : pr);
      }
    }
    this.lastScan = survivors;
    return [this.f(massW), this.f(massO)];
  }

  /** v1 bid with the completability gain added (copied from strategy.ts, dC inserted). */
  bid(v: { rack: Rack; balance: number; bagLeft: number; firstPrice: boolean; maxRivalBalance?: number; unseen?: Rack }, letter: number): number {
    if (v.bagLeft <= 0) return 0;
    const p = this.p;
    const cp = this.cp;
    const after = v.bagLeft - 1;
    const withL = Int8Array.from(v.rack);
    withL[letter]++;
    const candsWith = this.dict.candidates(withL);
    const candsWithout = this.dict.filter(candsWith, v.rack);
    let gain = this.value(withL, after, candsWith) - this.value(v.rack, after, candsWithout);
    if (cp.cw > 0 && v.unseen) {
      const [cW, cO] = this.completability(v.rack, letter, v.unseen, after);
      const fade = cp.cFade > 0 ? 1 - this.beta(after) : 1;
      gain += fade * (cW - cO);
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
    if (v.firstPrice) amt *= 0.6;
    amt = Math.min(amt, v.balance * p.maxFrac + (v.bagLeft < 6 ? v.balance : 0));
    if (v.bagLeft <= p.lateFillN && v.balance >= 2 * p.lateFill) amt = Math.max(amt, p.lateFill);
    if (p.marketFloor > 0 && gain >= p.marketFloorMinGain) {
      const floor = p.marketFloor * marketMedian(letter, v.bagLeft);
      if (v.balance >= 2 * floor) amt = Math.max(amt, floor);
    }
    amt = Math.max(amt, p.minBid);
    return Math.max(0, Math.min(cap, Math.round(amt)));
  }
}

export function makePolicy(d: Dict, over: Partial<CParams>, _rnd: () => number): Policy & { letter: number } {
  const brain = new CBrain(d, { ...C_DEFAULTS, ...over });
  const pol = {
    letter: 0,
    reset() {},
    bid(s: State) {
      return brain.bid(
        { rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice, maxRivalBalance: s.maxRivalBalance, unseen: s.unseen },
        pol.letter,
      );
    },
    words(s: State) {
      return brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
    },
    observePrice(_s: State, _letter: number, _paid: number, _weWon: boolean) {},
  };
  return pol;
}
