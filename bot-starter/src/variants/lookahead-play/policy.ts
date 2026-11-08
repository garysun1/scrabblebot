// lookahead-play: v1 bidding untouched, plus a principled play/hold decision
// for long words.
//
// For each candidate play (7+ letter words in the rack; optionally 6s) we
// compare, by a small Monte Carlo over k sampled unseen tiles F:
//   hold = E[ exact(rack + F) ]
//   play = reward(w) + E[ exact(rack - w + F) ] + cashValue(reward(w))
// where exact() is the hoard-free best partition (budget mcBudget) and
// cashValue converts coins we could still usefully spend into points at
// cashRate (zero when we already hold more cash than the remaining auctions
// can absorb). Play when play - hold > margin. Short words keep v1's rule
// (hold; 5+ only when starved), so this cannot repeat v2's "cash everything
// early" failure.
//
// Run: REPLAY_POLICY=./variants/lookahead-play/policy.ts <tsx> src/replay.ts x 200 11 '{}'
import type { Dict, Rack } from "../../engine.js";
import { bestPartition, rackSize } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "../../strategy.js";
import type { Policy } from "../../replay.js";

export interface LookParams {
  mcOn: number; // 1 = use the MC play/hold decision, 0 = pure v1 words()
  minPlayLen: number; // consider playing words at least this long
  autoPlayLen: number; // play words at least this long immediately (99 = never)
  samples: number; // MC futures per decision
  kFrac: number; // k = round(kFrac * bagLeft) sampled unseen tiles...
  kMin: number; // ...clamped to [kMin, min(kMax, bagLeft)]
  kMax: number;
  mcBudget: number; // partition search nodes per MC evaluation
  cashRate: number; // points per coin of spendable cash gained by playing now
  spendRate: number; // coins the remaining auctions can usefully absorb, per auction
  margin: number; // play only if E[play] - E[hold] exceeds this (points)
  maxCands: number; // candidate plays considered per decision
  mcMinBag: number; // below this bagLeft the cash term is 0 (cash can't convert any more)
  starveK: number; // dynamic starve threshold = min(starveCash, starveK * bagLeft) (0 = v1's fixed starveCash)
  mcCands: number; // MC partition search sees only the top this-many playable classes by reward
  mcMinWordLen: number; // ...of at least this length
  mcTimeMs: number; // stop sampling after this many ms (at least 2 samples)
}

export const DEFAULT_LOOK: LookParams = {
  mcOn: 1,
  minPlayLen: 7,
  autoPlayLen: 99,
  samples: 8,
  kFrac: 0.25,
  kMin: 1,
  kMax: 8,
  mcBudget: 300,
  cashRate: 0.3,
  spendRate: 3.0,
  margin: 2,
  maxCands: 3,
  mcMinBag: 4,
  starveK: 0,
  mcCands: 250,
  mcMinWordLen: 3,
  mcTimeMs: 40,
};

type AllParams = Params & LookParams;

export class LookBrain extends Brain {
  q: LookParams;
  rnd: () => number;
  // instrumentation (read by time.ts / debugging)
  stats = { decisions: 0, plays: 0, msMax: 0, msTotal: 0 };

  constructor(d: Dict, p: AllParams, rnd: () => number) {
    super(d, p);
    this.q = p;
    this.rnd = rnd;
  }

  /** k tiles sampled without replacement from the unseen pool. */
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

  /** Hoard-free word points of a rack with a bounded search. */
  exact(r: Rack, cands: number[]): number {
    if (rackSize(r) < 2) return 0;
    return bestPartition(this.dict, r, cands, () => 0, this.q.mcBudget).wordScore;
  }

  /** Points value of R coins arriving now. */
  cashValue(R: number, balance: number, bagLeft: number): number {
    const q = this.q;
    if (bagLeft < q.mcMinBag) return 0;
    const room = Math.max(0, q.spendRate * bagLeft - balance);
    return q.cashRate * Math.min(R, room);
  }

  /** Words to play now (dictionary indices). */
  decide(s: State): number[] {
    const p = this.p;
    const q = this.q;
    const rack = s.rack;
    if (rackSize(rack) < 2) return [];
    const plan = this.plan(rack, s.bagLeft);
    if (s.bagLeft <= p.flushAt) return plan.words;
    // v1 starve rule, optionally with a threshold that shrinks as the match ends.
    const thr = q.starveK > 0 ? Math.min(p.starveCash, q.starveK * s.bagLeft) : p.starveCash;
    if (s.balance < thr) {
      const ws = plan.words.filter((k) => this.dict.len[k] >= 5);
      if (ws.length) return ws;
    }
    const v1Words = plan.words.filter((k) => this.dict.len[k] >= p.minMidLen);
    // Candidate plays: long words of the plan plus the best long single words.
    const longCands = this.dict.candidates(rack, Math.min(q.minPlayLen, q.autoPlayLen));
    if (longCands.length === 0) return v1Words;
    // 8+ letter words (if enabled): nothing left to grow into, cash the best one.
    for (const k of longCands) if (this.dict.len[k] >= q.autoPlayLen) return [k];
    if (q.mcOn <= 0) return v1Words;
    const set = new Set<number>();
    for (const k of plan.words) if (this.dict.len[k] >= q.minPlayLen) set.add(k);
    for (const k of longCands) {
      if (set.size >= q.maxCands) break;
      if (this.dict.len[k] >= q.minPlayLen) set.add(k);
    }
    if (set.size === 0) return v1Words;
    const list = [...set].sort((a, b) => this.dict.rew[b] - this.dict.rew[a]).slice(0, q.maxCands);

    const t0 = performance.now();
    const k = Math.max(q.kMin, Math.min(q.kMax, s.bagLeft, Math.round(q.kFrac * s.bagLeft)));
    const racks: Rack[] = [rack];
    for (const w of list) {
      const r = Int8Array.from(rack);
      const o = w * 26;
      for (let i = 0; i < 26; i++) r[i] -= this.dict.counts[o + i];
      racks.push(r);
    }
    const sums = new Array<number>(racks.length).fill(0);
    let S = 0;
    for (let n = 0; n < Math.max(1, q.samples); n++) {
      // Hard time guard: live auctions are 1 s and the bid itself costs time.
      if (n >= 2 && performance.now() - t0 > q.mcTimeMs) break;
      const F = this.sampleFuture(s.unseen, k);
      const supF = Int8Array.from(rack);
      for (const l of F) supF[l]++;
      // Top candidates by reward only: big racks have thousands of playable
      // classes and the partition search loops over the list at every node.
      let cands = this.dict.candidates(supF, q.mcMinWordLen);
      if (cands.length > q.mcCands) cands = cands.slice(0, q.mcCands);
      for (let j = 0; j < racks.length; j++) {
        const rf = Int8Array.from(racks[j]);
        for (const l of F) rf[l]++;
        const c = j === 0 ? cands : this.dict.filter(cands, rf);
        sums[j] += this.exact(rf, c);
      }
      S++;
    }
    const hold = sums[0] / S;
    let bestK = -1;
    let bestGain = q.margin;
    list.forEach((w, j) => {
      const R = this.dict.rew[w];
      const play = R + sums[j + 1] / S + this.cashValue(R, s.balance, s.bagLeft);
      if (play - hold > bestGain) {
        bestGain = play - hold;
        bestK = w;
      }
    });
    const dt = performance.now() - t0;
    this.stats.decisions++;
    this.stats.msTotal += dt;
    if (dt > this.stats.msMax) this.stats.msMax = dt;
    if (bestK >= 0) this.stats.plays++;
    return bestK >= 0 ? [bestK] : [];
  }
}

export function makePolicy(d: Dict, over: Partial<AllParams>, rnd: () => number): Policy & { letter: number; brain: LookBrain } {
  const brain = new LookBrain(d, { ...DEFAULT_PARAMS, ...DEFAULT_LOOK, ...over }, rnd);
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
      return brain.decide(s);
    },
    observePrice(_s: State, _letter: number, _paid: number, _weWon: boolean) {},
  };
  return pol;
}
