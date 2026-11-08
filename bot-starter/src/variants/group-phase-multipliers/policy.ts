// Variant `group-phase-multipliers`: v1 brain with a learned 12-entry bid
// multiplier table M[letterGroup][phase], applied to the raw marginal-value
// bid BEFORE premium/shade/caps/floors/minBid/all-in:
//
//   groups: v   = vowels (A E I O U)
//           c1  = 1-point consonants (L N R S T)
//           c24 = 2-4 point letters (D G B C M P F H V W Y)
//           c5  = 5+ point letters (K J X Q Z)
//   phases: e = bagLeft > 45, m = 15 <= bagLeft <= 45, l = bagLeft < 15
//
// Over keys: `<group>_<phase>` (e.g. {"c5_e":1.3}) or "M": [12 numbers] in the
// order v_e v_m v_l c1_e c1_m c1_l c24_e c24_m c24_l c5_e c5_m c5_l.
// "floorScale": 1 also multiplies the market floor by the same entry (default 0:
// the market floor stays exactly v1's). Any other key is passed through to v1 Params.
//
// Run: REPLAY_POLICY=./variants/group-phase-multipliers/policy.ts <tsx> src/replay.ts x 200 11 '{"c5_e":1.2}'
import { readFileSync } from "node:fs";
import { FACE, VOWEL, type Dict } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params, type View } from "../../strategy.js";
import type { Policy } from "../../replay.js";

export const GROUPS = ["v", "c1", "c24", "c5"] as const;
export const PHASES = ["e", "m", "l"] as const;
export const TABLE_KEYS: string[] = GROUPS.flatMap((g) => PHASES.map((p) => `${g}_${p}`));

export function groupOf(letter: number): number {
  if (VOWEL[letter]) return 0;
  const f = FACE[letter];
  if (f === 1) return 1;
  if (f <= 4) return 2;
  return 3;
}
export function phaseOf(bagLeft: number): number {
  if (bagLeft > 45) return 0;
  if (bagLeft >= 15) return 1;
  return 2;
}

// Copy of strategy.ts's (non-exported) market median lookup.
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

export class GroupPhaseBrain extends Brain {
  constructor(
    dict: Dict,
    p: Params,
    public M: number[][], // [group][phase]
    public floorScale = false,
  ) {
    super(dict, p);
  }

  /** v1's Brain.bid, verbatim, plus `amt *= M[group][phase]` right after the raw bid. */
  bid(v: View, letter: number): number {
    if (v.bagLeft <= 0) return 0;
    const p = this.p;
    const after = v.bagLeft - 1;
    const withL = Int8Array.from(v.rack);
    withL[letter]++;
    const candsWith = this.dict.candidates(withL);
    const candsWithout = this.dict.filter(candsWith, v.rack);
    let gain = this.value(withL, after, candsWith) - this.value(v.rack, after, candsWithout);
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
    // ---- the only change vs v1: learned group x phase multiplier ----
    const mult = this.M[groupOf(letter)][phaseOf(v.bagLeft)];
    amt *= mult;
    // -----------------------------------------------------------------
    if (FACE[letter] >= 5 && v.bagLeft > p.premiumUntil && !(letter === 16 && v.rack[20] === 0)) amt *= p.premiumMult;
    if (v.firstPrice) amt *= 0.6;
    amt = Math.min(amt, v.balance * p.maxFrac + (v.bagLeft < 6 ? v.balance : 0));
    if (v.bagLeft <= p.lateFillN && v.balance >= 2 * p.lateFill) amt = Math.max(amt, p.lateFill);
    if (p.marketFloor > 0 && gain >= p.marketFloorMinGain) {
      const floor = p.marketFloor * marketMedian(letter, v.bagLeft) * (this.floorScale ? mult : 1);
      if (v.balance >= 2 * floor) amt = Math.max(amt, floor);
    }
    amt = Math.max(amt, p.minBid);
    return Math.max(0, Math.min(cap, Math.round(amt)));
  }
}

export function parseTable(over: Record<string, unknown>): { M: number[][]; floorScale: boolean; rest: Partial<Params> } {
  const M = GROUPS.map(() => PHASES.map(() => 1));
  const rest: Record<string, unknown> = {};
  let floorScale = false;
  for (const [k, val] of Object.entries(over)) {
    const ti = TABLE_KEYS.indexOf(k);
    if (ti >= 0) M[Math.floor(ti / 3)][ti % 3] = Number(val);
    else if (k === "M" && Array.isArray(val)) val.forEach((x, i) => (M[Math.floor(i / 3)][i % 3] = Number(x)));
    else if (k === "floorScale") floorScale = Number(val) > 0;
    else rest[k] = val;
  }
  return { M, floorScale, rest: rest as Partial<Params> };
}

export function makePolicy(d: Dict, over: Record<string, unknown>, _rnd: () => number): Policy & { letter: number; brain: GroupPhaseBrain } {
  const { M, floorScale, rest } = parseTable(over ?? {});
  const brain = new GroupPhaseBrain(d, { ...DEFAULT_PARAMS, ...rest }, M, floorScale);
  const pol = {
    brain,
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
