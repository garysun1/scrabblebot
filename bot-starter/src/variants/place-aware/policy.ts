// place-aware: v1 brain + an endgame layer that values points by how much they
// can change our finishing PLACE (the tournament metric), not by raw score.
//
// Each rival's final score is modelled as Normal(mu_i, sd_i) with
//   mu_i = a(bagLeft) + b(bagLeft) * scoreNow_i + c(bagLeft) * spentNow_i
// fitted on the train half of replay_hack.json (scratchpad/pa_fit.ts); spentNow is
// inferred live from public data: spent = 100 + score - balance. Our own projected
// final X = score + flush value of the rack + a small cash-conversion term.
// The marginal place value of a point is the summed rival density at X; the bid
// (before market floor / late fill / all-in) is multiplied by
//   clamp(density / pwRef, pwMin, pwMax) ^ pwGamma
// inside the last pwN auctions. Optionally, when P(1st) >= bankP inside the last
// bankN auctions, 7+ letter words are banked at once instead of held to the flush.
//
// Run: REPLAY_POLICY=./variants/place-aware/policy.ts <tsx> src/replay.ts x 200 11 '{"pwN":20}'
import type { Dict } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "./strategy.js";
import type { Policy } from "../../replay.js";

export interface PlaceParams {
  pwN: number; // apply the place multiplier when bagLeft <= pwN (0 = layer off)
  pwRef: number; // reference rival density (per point) at which the multiplier is 1
  pwMin: number; // clamp
  pwMax: number;
  pwGamma: number; // exponent on the clamped ratio
  futK: number; // our expected extra points per coin we can still spend
  futPrice: number; // coins per tile we expect to pay for the rest of the match
  ownSd: number; // our own final-score uncertainty, as a fraction of the rivals' sd
  bankN: number; // bank long words when bagLeft <= bankN and 1st is secure (0 = off)
  bankP: number; // ...P(1st) threshold
  bankLen: number; // ...minimum word length to bank
}

export const DEFAULT_PLACE: PlaceParams = {
  pwN: 20,
  pwRef: 0.06,
  pwMin: 0.6,
  pwMax: 1.8,
  pwGamma: 1,
  futK: 0.3,
  futPrice: 13,
  ownSd: 0.6,
  bankN: 0,
  bankP: 0.85,
  bankLen: 7,
};

// bagLeft, a, b, c, sd  -- rival final ~ a + b*scoreNow + c*spentNow (train half, 354 rows each)
const TBL: number[][] = [
  [30, 46.0, 0.62, 0.03, 30.3],
  [25, 38.9, 0.62, 0.07, 28.4],
  [20, 29.8, 0.74, 0.06, 25.1],
  [15, 21.8, 0.74, 0.09, 21.8],
  [10, 12.5, 0.88, 0.05, 15.9],
  [6, 8.3, 0.87, 0.06, 12.0],
  [3, 4.2, 0.86, 0.07, 9.8],
  [1, 2.2, 0.89, 0.06, 7.5],
];
function rowAt(bagLeft: number): number[] {
  if (bagLeft >= TBL[0][0]) return TBL[0];
  if (bagLeft <= TBL[TBL.length - 1][0]) return TBL[TBL.length - 1];
  for (let i = 0; i < TBL.length - 1; i++) {
    const hi = TBL[i], lo = TBL[i + 1];
    if (bagLeft <= hi[0] && bagLeft >= lo[0]) {
      const t = (bagLeft - lo[0]) / (hi[0] - lo[0]);
      return hi.map((h, j) => lo[j] + t * (h - lo[j]));
    }
  }
  return TBL[TBL.length - 1];
}
// standard normal pdf / cdf (Abramowitz-Stegun 7.1.26 erf)
function phi(z: number): number {
  return Math.exp(-0.5 * z * z) / 2.5066282746310002;
}
function Phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface PlaceView {
  x: number; // our projected final
  mu: number[]; // rivals' projected finals
  sd: number[];
  density: number; // d(expected rivals beaten)/d(point) at x
  expPlace: number; // 1 + sum P(rival beats us)
  pFirst: number;
}

export function placeView(s: State, flushValue: number, pp: PlaceParams): PlaceView | null {
  if (!s.rivals || s.rivals.length === 0 || s.score === undefined || !s.rivalScores) return null;
  const row = rowAt(s.bagLeft);
  const [, a, b, c, sd] = row;
  const fut = pp.futK * Math.min(s.balance, pp.futPrice * s.bagLeft);
  const x = s.score + flushValue + fut;
  const own = pp.ownSd * sd;
  const mu: number[] = [], sds: number[] = [];
  let density = 0, expPlace = 1, pFirst = 1;
  for (const rv of s.rivals) {
    const sc = s.rivalScores[rv.id] ?? 0;
    const spent = Math.max(0, 100 + sc - rv.balance);
    const m = Math.max(sc, a + b * sc + c * spent); // a rival can't finish below what it has
    const sg = Math.max(3, Math.sqrt(sd * sd + own * own));
    const z = (x - m) / sg;
    const pBeat = Phi(z); // P(we finish above this rival)
    mu.push(m); sds.push(sg);
    density += phi(z) / sg;
    expPlace += 1 - pBeat;
    pFirst *= pBeat;
  }
  return { x, mu, sd: sds, density, expPlace, pFirst };
}

export function makePolicy(d: Dict, over: Partial<Params & PlaceParams>, _rnd: () => number): Policy & { letter: number } {
  const bp: Params = { ...DEFAULT_PARAMS };
  const pp: PlaceParams = { ...DEFAULT_PLACE };
  for (const k of Object.keys(over)) {
    if (k in pp) (pp as any)[k] = (over as any)[k];
    else (bp as any)[k] = (over as any)[k];
  }
  const brain = new Brain(d, bp);
  let cacheIdx = -1, cacheFlush = 0;
  const flushValue = (s: State) => {
    const idx = s.auctionIndex ?? -2;
    if (idx !== cacheIdx) { cacheIdx = idx; cacheFlush = brain.plan(s.rack, 0).score; }
    return cacheFlush;
  };
  const view = (s: State) => (s.bagLeft <= Math.max(pp.pwN, pp.bankN) ? placeView(s, flushValue(s), pp) : null);
  // PA_DEBUG=1: histogram of the multiplier and of our expected place inside the window
  const dbg = process.env.PA_DEBUG ? { mult: new Map<string, number>(), ep: new Map<string, number>(), n: 0, bank: 0 } : null;
  if (dbg) process.on("exit", () => {
    const fmt = (m: Map<string, number>) => [...m].sort().map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(`PA_DEBUG n=${dbg.n} bank=${dbg.bank}\n mult ${fmt(dbg.mult)}\n expPlace ${fmt(dbg.ep)}`);
  });
  const pol = {
    letter: 0,
    reset() { cacheIdx = -1; },
    bid(s: State) {
      let placeMult = 1;
      const pv = pp.pwN > 0 && s.bagLeft <= pp.pwN ? view(s) : null;
      if (pv) placeMult = Math.pow(Math.max(pp.pwMin, Math.min(pp.pwMax, pv.density / pp.pwRef)), pp.pwGamma);
      if (dbg && pv) {
        dbg.n++;
        const mk = placeMult.toFixed(1), ek = pv.expPlace.toFixed(0);
        dbg.mult.set(mk, (dbg.mult.get(mk) ?? 0) + 1);
        dbg.ep.set(ek, (dbg.ep.get(ek) ?? 0) + 1);
      }
      return brain.bid({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice, maxRivalBalance: s.maxRivalBalance, unseen: s.unseen, placeMult }, pol.letter);
    },
    words(s: State) {
      let bankNow = false;
      if (pp.bankN > 0 && s.bagLeft <= pp.bankN && s.bagLeft > bp.flushAt) {
        const pv = view(s);
        if (pv && pv.pFirst >= pp.bankP) bankNow = true;
        if (dbg && bankNow) dbg.bank++;
      }
      const ws = brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice, bankNow, bankLen: pp.bankLen });
      if (ws.length > 0) cacheIdx = -1; // the rack changes after a play: invalidate the flush cache
      return ws;
    },
    observePrice(_s: State, _letter: number, _paid: number, _weWon: boolean) {},
  };
  return pol;
}
