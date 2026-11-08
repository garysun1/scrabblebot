// leader-imitation: v1 brain + a per-cell floor taken from the archive of what
// the four leaders (Lbender, RackMaw, LexForge-1107, GodOfThudner) actually bid
// when they WON a letter, by letter x phase (early/mid/late thirds) x whether
// they already visibly held that letter.  When our own v1 marginal gain agrees
// the letter is useful (gain >= liMinGain) we bid at least their typical
// winning bid (quantile liQ: 0=q50 1=q60 2=q75 3=q90), optionally capped at
// their p90 (liCap) and with a separate quantile for premium (5+ pt) letters
// (liQPrem, the "purchase-mix nudge").  Table: leaders_q.json (built by
// analyze_leaders.py from the scratchpad archive, never read at decision time
// beyond this static file).
//
// Run: REPLAY_POLICY=./variants/leader-imitation/policy.ts <tsx> src/replay.ts x 200 11 '{"liQ":1,"liMinGain":2}'
import { readFileSync } from "node:fs";
import { FACE, type Dict } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "../../strategy.js";
import type { Policy } from "../../replay.js";

type LiParams = {
  liQ: number; // quantile index for the leader floor: 0=q50 1=q60 2=q75 3=q90 (-1 = off)
  liQPrem: number; // quantile index for 5+ point letters (-2 = same as liQ)
  liMinGain: number; // apply the floor only when our v1 marginal gain >= this
  liMinGainPrem: number; // ...for premium letters (-1 = same as liMinGain)
  liCap: number; // >0: cap the bid at liCap x leaders' p90 for the cell (0 = off)
  liAfford: number; // apply the floor only if balance >= liAfford x floor
  liScale: number; // multiply the leader quantile by this
  liMarket: number; // keep v1's own market floor too (1) or disable it (0)
  liHold: number; // 1: use the holds-letter dimension, 0: always the not-holding cell
};

const LI_DEFAULT: LiParams = {
  liQ: 0,
  liQPrem: -2,
  liMinGain: 2,
  liMinGainPrem: -1,
  liCap: 0,
  liAfford: 2,
  liScale: 1,
  liMarket: 1,
  liHold: 1,
};

// Q[letter][phase][hold] = [q50, q60, q75, q90] of the leaders' winning (top) bids
let Q: number[][][][] | null = null;
function loadQ(): number[][][][] {
  if (!Q) {
    Q = JSON.parse(readFileSync(new URL("./leaders_q.json", import.meta.url), "utf8")).Q;
  }
  return Q!;
}

// Replica of strategy.ts marketMedian (module-private there) so we can reuse
// the marginal gain instead of computing the partition search twice.
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

type View = { rack: Int8Array; balance: number; bagLeft: number; firstPrice: boolean; maxRivalBalance?: number; unseen?: Int8Array };

/** Exact copy of the tail of Brain.bid (strategy.ts) given an already computed marginal gain. */
function v1Tail(brain: Brain, v: View, letter: number, gain: number): number {
  const p = brain.p;
  if (p.nearW > 0 && FACE[letter] >= p.nearMinFace && v.unseen && v.bagLeft > 3) {
    const withL = Int8Array.from(v.rack);
    withL[letter]++;
    gain += p.nearW * brain.nearValue(withL, letter, v.unseen, v.bagLeft);
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

const GROUP = (l: number) => {
  if ("AEIOU".includes(String.fromCharCode(65 + l))) return 0;
  const f = FACE[l];
  return f === 1 ? 1 : f <= 4 ? 2 : 3;
};
const GNAME = ["vowel", "cons1", "cons2-4", "prem5+"];

export function makePolicy(d: Dict, over: Partial<Params & LiParams>, _rnd: () => number): Policy & { letter: number } {
  const li: LiParams = { ...LI_DEFAULT };
  const bp: Partial<Params> = {};
  for (const [k, v] of Object.entries(over)) {
    if (k in LI_DEFAULT) (li as unknown as Record<string, number>)[k] = v as number;
    else (bp as Record<string, unknown>)[k] = v;
  }
  const params: Params = { ...DEFAULT_PARAMS, ...bp };
  if (!li.liMarket) params.marketFloor = 0;
  const brain = new Brain(d, params);
  const Qt = loadQ();
  const stats = process.env.LI_STATS ? Array.from({ length: 3 }, () => [0, 0, 0, 0]) : null;
  if (stats) {
    process.on("exit", () => {
      for (let ph = 0; ph < 3; ph++) {
        const t = stats[ph].reduce((a, b) => a + b, 0) || 1;
        console.log(`LI_STATS phase ${ph}: ` + GNAME.map((g, i) => `${g}=${(stats[ph][i] / t).toFixed(3)}`).join(" ") + ` n=${t}`);
      }
    });
  }

  const phaseOf = (s: State): number => {
    const total = s.totalAuctions || 68;
    const idx = s.auctionIndex ?? total - 1 - s.bagLeft;
    return Math.max(0, Math.min(2, Math.floor((idx * 3) / total)));
  };

  const pol = {
    letter: 0,
    reset() {},
    bid(s: State) {
      const letter = pol.letter;
      const view = { rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice, maxRivalBalance: s.maxRivalBalance, unseen: s.unseen };
      // v1's bid; recompute the marginal gain the same way v1 does (cheap: the
      // partition search is the cost and we would pay it anyway).
      if (s.bagLeft <= 0) return 0;
      const p = brain.p;
      const after = s.bagLeft - 1;
      const withL = Int8Array.from(s.rack);
      withL[letter]++;
      const candsWith = d.candidates(withL);
      const candsWithout = d.filter(candsWith, s.rack);
      const gain = brain.value(withL, after, candsWith) - brain.value(s.rack, after, candsWithout);
      let amt = v1Tail(brain, view, letter, gain);
      if (li.liQ < 0 || s.firstPrice || s.bagLeft <= p.allIn) return amt;
      const prem = FACE[letter] >= 5;
      const qi = prem && li.liQPrem >= 0 ? li.liQPrem : li.liQ;
      const minGain = prem && li.liMinGainPrem >= 0 ? li.liMinGainPrem : li.liMinGain;
      const cap = Math.min(s.balance, (s.maxRivalBalance ?? Infinity) + 1);
      if (gain >= minGain) {
        const hold = li.liHold && s.rack[letter] > 0 ? 1 : 0;
        const cell = Qt[letter][phaseOf(s)][hold];
        const floor = Math.round(cell[qi] * li.liScale);
        if (s.balance >= li.liAfford * floor) amt = Math.max(amt, floor);
        if (li.liCap > 0) amt = Math.min(amt, Math.max(p.minBid, Math.round(cell[3] * li.liCap)));
        amt = Math.max(0, Math.min(cap, amt));
      }
      return amt;
    },
    words(s: State) {
      return brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
    },
    observePrice(s: State, letter: number, _paid: number, weWon: boolean) {
      if (stats && weWon) stats[phaseOf(s)][GROUP(letter)]++;
    },
  };
  return pol;
}
