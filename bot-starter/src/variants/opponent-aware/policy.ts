// Variant "opponent-aware": v1 bid, but the floor / denial / sniping layer is
// decided against the five bots actually seated instead of an average market.
//
//  (a) rivalFloor: v1 raises any bid with marginal value >= 2 to the archive
//      median winning bid for the letter x phase. Here that floor is replaced
//      (or mixed) with a quantile of the composed max-rival-bid distribution:
//      each seated rival's fitted LogNormal bid model (bots.json, generic when
//      unmodeled), truncated at its live balance, with an online "heat"
//      multiplier from clearing prices in this match.
//      Note: in a Vickrey auction the EV-optimal bid under ANY rival
//      distribution is the truthful value/lambda, so the distribution can only
//      change the floor layer and the pacing, not the core bid (see RESULT.md).
//  (b) denial: when a rival within `denialBand` points of us can still bid
//      above us, add up to `denialN` coins x P(that rival bids >= our bid), so
//      a contender pays more or we take the tile.
//  (c) sniping: when the richest rival's balance <= snipeBelow, bid the cap
//      (richest rival balance + 1) on any letter worth >= snipeMinGain: nobody
//      can outbid us and leftover cash is worth nothing.
//
// Run: REPLAY_POLICY=./variants/opponent-aware/policy.ts <tsx> src/replay.ts x 200 11 '{"rivalFloorQ":0.5}'
import type { Dict } from "../../engine.js";
import { FACE } from "../../engine.js";
import { Brain2, DEFAULT_PARAMS2, type State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "./brain.js";
import type { Policy } from "../../replay.js";

export interface OppParams {
  rivalFloorQ: number; // quantile of the composed max-rival-bid distribution used as the floor (0 = keep v1's market floor)
  rivalFloorW: number; // floor = (1 - w) * v1 market floor + w * rival quantile
  heat0: number; // prior price heat (1 = as fitted in market.json)
  heatWeight: number; // EMA weight of the online heat from clearing prices (0 = fixed heat0)
  denialN: number; // max coins added against a score contender (0 = off)
  denialBand: number; // contender = rival within this many points of our score
  denialMinGain: number; // only when the letter's marginal value is at least this
  denialMinFace: number; // ...and its face value is at least this
  denialUntil: number; // only while bagLeft > this (the late game already fills)
  snipeBelow: number; // richest rival balance <= this -> bid the cap on useful letters (0 = off)
  snipeMinGain: number;
}

export const DEFAULT_OPP: OppParams = {
  rivalFloorQ: 0,
  rivalFloorW: 1,
  heat0: 1,
  heatWeight: 0,
  denialN: 0,
  denialBand: 15,
  denialMinGain: 2,
  denialMinFace: 1,
  denialUntil: 16,
  snipeBelow: 0,
  snipeMinGain: 1,
};

function erf(x: number): number {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

export function makePolicy(d: Dict, over: Partial<Params & OppParams>, _rnd: () => number): Policy & { letter: number } {
  const p: Params & OppParams = { ...DEFAULT_PARAMS, ...DEFAULT_OPP, ...over };
  const brain = new Brain(d, p);
  const model = new Brain2(d, { ...DEFAULT_PARAMS2, useRivals: true });
  let heat = p.heat0;

  /** Smallest integer bid x such that P(max rival bid <= x) >= q. */
  function rivalQuantile(s: State, letter: number, q: number, limit: number): number {
    const cdf = model.maxRivalCdf(s, letter, model.phase(s));
    for (let x = 1; x <= limit; x++) if (cdf(x) >= q) return x;
    return limit;
  }

  /** Max over score-contenders of P(that rival bids >= amt). */
  function contenderWant(s: State, letter: number, amt: number): number {
    if (!s.rivals || !s.rivalScores) return 0;
    const ph = model.phase(s);
    const r = model.row(letter, ph);
    const base = r.mu + Math.log(s.heat || 1);
    const g = FACE[letter] === 1 ? 0 : FACE[letter] <= 4 ? 1 : 2;
    const late = ph >= 3 ? 1 : 0;
    const ours = s.score ?? 0;
    let best = 0;
    for (const rv of s.rivals) {
      const sc = s.rivalScores[rv.id] ?? 0;
      if (Math.abs(sc - ours) > p.denialBand) continue;
      if (rv.balance <= amt) continue; // cannot bid above us anyway
      const m = model.rivalModel(rv.id);
      const mu = base + m.off[g] + m.late * late;
      const pr = (1 - m.p0) * (1 - Phi((Math.log(amt + 0.5) - mu) / m.sigma));
      if (pr > best) best = pr;
    }
    return best;
  }

  const pol = {
    letter: 0,
    reset() {
      heat = p.heat0;
    },
    bid(s: State) {
      const letter = pol.letter;
      const view = { rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice, maxRivalBalance: s.maxRivalBalance, unseen: s.unseen };
      const parts = brain.bidParts(view, letter);
      if (parts.special) return parts.bid;
      s.heat = heat;
      const haveRivals = !!s.rivals && s.rivals.length > 0;
      let amt = parts.pre;
      // Floor layer.
      let floor = parts.floor;
      if (haveRivals && p.rivalFloorQ > 0 && parts.gain >= p.marketFloorMinGain) {
        const q = rivalQuantile(s, letter, p.rivalFloorQ, Math.max(1, Math.min(200, parts.cap)));
        floor = (1 - p.rivalFloorW) * parts.floor + p.rivalFloorW * q;
      }
      if (floor > 0 && s.balance >= 2 * floor) amt = Math.max(amt, floor);
      // Denial / price-driving against score contenders.
      if (haveRivals && p.denialN > 0 && s.bagLeft > p.denialUntil && parts.gain >= p.denialMinGain && FACE[letter] >= p.denialMinFace) {
        amt += p.denialN * contenderWant(s, letter, amt);
      }
      // Broke-table sniping: nobody can outbid the cap.
      if (p.snipeBelow > 0 && s.maxRivalBalance !== undefined && s.maxRivalBalance <= p.snipeBelow && parts.gain >= p.snipeMinGain && s.bagLeft >= 2) {
        amt = Math.max(amt, s.maxRivalBalance + 1);
      }
      amt = Math.max(amt, p.minBid);
      return Math.max(0, Math.min(parts.cap, Math.round(amt)));
    },
    words(s: State) {
      return brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
    },
    observePrice(s: State, letter: number, paid: number, _weWon: boolean) {
      if (p.heatWeight <= 0 || paid <= 0) return;
      const ref = model.row(letter, model.phase(s)).medSecond || 7;
      const ratio = Math.max(0.3, Math.min(3, paid / ref));
      heat = heat * (1 - p.heatWeight) + ratio * p.heatWeight;
    },
  };
  return pol;
}
