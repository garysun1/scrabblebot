// Variant "flush-solver": most of our points are scored at the final flush
// (bagLeft <= 1), where v1 plays the best partition found by `bestPartition`
// with a 3000-node budget. This variant
//   (1) instruments the gap between that 3000-node partition and a much
//       stronger search on the actual flush racks (INSTRUMENT=1),
//   (2) replaces the flush solver with `strongPartition`: branch and bound
//       that filters the candidate list per node (so deep nodes are cheap)
//       and uses a tighter bound (length multiplier of the remaining rack,
//       and floor(n/2) x best remaining reward), time-capped,
//   (3) exposes flush-timing knobs: flushAt, preFlushAt/preFlushLen (play
//       7+ letter words a few auctions before the flush), playNowLen (play
//       8+ letter words as soon as they appear),
//   (4) exactGainAt: bid with the exact partition gain (beta = 1) when
//       bagLeft <= exactGainAt, and strongBidAt: use the strong solver for
//       the two valuations inside bid() when bagLeft <= strongBidAt.
//
// Run:
//   REPLAY_FILE=./replay_hack.json REPLAY_SPLIT=test REPLAY_SEEDS=4 \
//   REPLAY_POLICY=./variants/flush-solver/policy.ts node_modules/.bin/tsx src/replay.ts x 200 11 '{"solver":1}'
import { Dict, FACE, type Partition, type Rack, bestPartition, rackFace, rackMask, rackSize } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params, type View } from "../../strategy.js";
import type { Policy } from "../../replay.js";

export interface XParams extends Params {
  solver: number; // 0 = v1 bestPartition at the flush; 1 = strongPartition
  bigBudget: number; // node budget of the strong solver
  bigMs: number; // time cap (ms) of the strong solver at the flush
  instrument: number; // 1 = log 3000-node vs strong solver on every flush rack (stats at exit)
  instBudget: number; // node budget of the reference solver when instrumenting
  preFlushAt: number; // bagLeft <= this (and > flushAt): play words of length >= preFlushLen (0 = off)
  preFlushLen: number;
  playNowLen: number; // mid-match, play words at least this long immediately (99 = off)
  exactGainAt: number; // bagLeft <= this: bid with beta = 1 (exact partition gain), 0 = off
  strongBidAt: number; // bagLeft <= this: use the strong solver for the valuations inside bid(), 0 = off
  strongBidMs: number; // per-valuation time cap for strongBidAt
  fastPlan: number; // 1 = use fastPartition (same objective/budget as bestPartition, cheaper nodes) for all plans
  fastSlack: number; // bound slack for hoard states in fastPartition
}

export const X_DEFAULTS: XParams = {
  ...DEFAULT_PARAMS,
  solver: 1,
  bigBudget: 400000,
  bigMs: 250,
  instrument: 0,
  instBudget: 3000,
  preFlushAt: 0,
  preFlushLen: 7,
  playNowLen: 99,
  exactGainAt: 0,
  strongBidAt: 0,
  strongBidMs: 50,
  fastPlan: 0,
  fastSlack: 8,
};

/** Best length multiplier any word made from n tiles can get. */
function MULT(n: number): number {
  return n >= 7 ? 3 : n === 6 ? 2.5 : n === 5 ? 2 : n === 4 ? 1.5 : 1;
}

export interface StrongResult extends Partition {
  nodes: number;
  complete: boolean; // false if cut by budget or time
  ms: number;
}

/**
 * Exact-when-it-finishes best partition (leftover value 0, i.e. the flush).
 * Depth-first branch and bound over the reward-desc candidate list. Unlike
 * `bestPartition`, each node filters the candidate list down to the words
 * that still fit, so children iterate a short list, and the bound is
 *   acc + min(face(rest) x MULT(|rest|), floor(|rest| / 2) x reward(best remaining candidate)).
 */
export function strongPartition(d: Dict, rack: Rack, cands: number[], budget = 400000, timeMs = 250): StrongResult {
  const r = Int8Array.from(rack);
  const t0 = performance.now();
  const deadline = t0 + timeMs;
  let bestWords: number[] = [];
  let bestScore = 0;
  let nodes = 0;
  let complete = true;
  const stack: number[] = [];
  const counts = d.counts;
  const dfs = (list: number[], acc: number, size: number, face: number) => {
    nodes++;
    if (acc > bestScore) {
      bestScore = acc;
      bestWords = stack.slice();
    }
    if (size < 2 || list.length === 0) return;
    const topRew = d.rew[list[0]];
    if (acc + Math.min(face * MULT(size), Math.floor(size / 2) * topRew) <= bestScore) return;
    for (let j = 0; j < list.length; j++) {
      if (nodes > budget || ((nodes & 63) === 0 && performance.now() > deadline)) {
        complete = false;
        return;
      }
      const k = list[j];
      const rk = d.rew[k];
      const ns = size - d.len[k];
      const nf = face - d.base[k];
      // Every later word in `list` has reward <= rk.
      if (acc + rk + Math.min(nf * MULT(ns), Math.floor(ns / 2) * rk) <= bestScore) continue;
      if (!d.fits(k, r)) continue;
      const o = k * 26;
      for (let i = 0; i < 26; i++) r[i] -= counts[o + i];
      stack.push(k);
      // Child list: words from j onward (a class may repeat) that still fit.
      const rm = rackMask(r);
      const child: number[] = [];
      for (let t = j; t < list.length; t++) {
        const c = list[t];
        if (d.len[c] > ns || (d.mask[c] & ~rm) !== 0) continue;
        if (d.fits(c, r)) child.push(c);
      }
      dfs(child, acc + rk, ns, nf);
      stack.pop();
      for (let i = 0; i < 26; i++) r[i] += counts[o + i];
      if (!complete) return;
    }
  };
  dfs(cands, 0, rackSize(r), rackFace(r));
  return { words: bestWords, score: bestScore, wordScore: bestScore, nodes, complete, ms: performance.now() - t0 };
}

/**
 * Same objective as `bestPartition` (sum of rewards + leftover(rest)) and the
 * same node budget, but with per-node candidate filtering and the tighter
 * length-multiplier bound, so a node costs far less on big racks. `slack`
 * guards the bound against leftover() growing when tiles are removed (hoard
 * has penalties), keep 0 when leftover is identically 0.
 */
export function fastPartition(
  d: Dict,
  rack: Rack,
  cands: number[],
  leftover: (r: Rack) => number = () => 0,
  budget = 3000,
  slack = 0,
): Partition {
  const r = Int8Array.from(rack);
  let best: Partition = { words: [], score: leftover(r), wordScore: 0 };
  let nodes = 0;
  const stack: number[] = [];
  const counts = d.counts;
  const dfs = (list: number[], acc: number, size: number, face: number) => {
    nodes++;
    const lv = leftover(r);
    if (acc + lv > best.score) best = { words: stack.slice(), score: acc + lv, wordScore: acc };
    if (size < 2 || list.length === 0) return;
    const lb = Math.max(lv, 0) + slack;
    const topRew = d.rew[list[0]];
    if (acc + Math.min(face * MULT(size), Math.floor(size / 2) * topRew) + lb <= best.score) return;
    for (let j = 0; j < list.length; j++) {
      if (nodes > budget) return;
      const k = list[j];
      const rk = d.rew[k];
      const ns = size - d.len[k];
      const nf = face - d.base[k];
      if (acc + rk + Math.min(nf * MULT(ns), Math.floor(ns / 2) * rk) + lb <= best.score) continue;
      if (!d.fits(k, r)) continue;
      const o = k * 26;
      for (let i = 0; i < 26; i++) r[i] -= counts[o + i];
      stack.push(k);
      const rm = rackMask(r);
      const child: number[] = [];
      for (let t = j; t < list.length; t++) {
        const c = list[t];
        if (d.len[c] > ns || (d.mask[c] & ~rm) !== 0) continue;
        if (d.fits(c, r)) child.push(c);
      }
      dfs(child, acc + rk, ns, nf);
      stack.pop();
      for (let i = 0; i < 26; i++) r[i] += counts[o + i];
    }
  };
  dfs(cands, 0, rackSize(r), rackFace(r));
  return best;
}

// ---- instrumentation (aggregated over the process, printed at exit) ----
const inst = {
  flushHist: new Array(40).fill(0), // rack size at the first flush call of each match
  ptsFlush: 0,
  ptsMid: 0,
  ptsStarved: 0,
  midPlays: 0,
  midBagSum: 0,
  matches: 0,
  n: 0,
  gainSum: 0,
  gainMax: 0,
  better: 0,
  worse: 0,
  baseMs: 0,
  strongMs: 0,
  strongNodes: 0,
  incomplete: 0,
  tiles: 0,
  baseScore: 0,
  strongScore: 0,
  bigRacks: 0,
  rows: [] as string[],
};
let exitHooked = false;
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", () => {
    if (inst.n === 0) return;
    console.log(
      `[flush-solver instrument] flush racks=${inst.n} (>=20 tiles: ${inst.bigRacks}) avg tiles ${(inst.tiles / inst.n).toFixed(1)} | ` +
        `base(budget ${X_DEFAULTS.instBudget}) avg ${(inst.baseScore / inst.n).toFixed(1)} pts ${(inst.baseMs / inst.n).toFixed(1)} ms | ` +
        `strong avg ${(inst.strongScore / inst.n).toFixed(1)} pts ${(inst.strongMs / inst.n).toFixed(1)} ms ${(inst.strongNodes / inst.n).toFixed(0)} nodes incomplete ${inst.incomplete} | ` +
        `gain avg ${(inst.gainSum / inst.n).toFixed(2)} max ${inst.gainMax} better ${inst.better} worse ${inst.worse}`,
    );
    if (process.env.INST_ROWS) for (const row of inst.rows) console.log(row);
    const tot = inst.ptsFlush + inst.ptsMid || 1;
    console.log(
      `[flush-solver instrument] matches=${inst.matches} points: flush ${inst.ptsFlush} (${((100 * inst.ptsFlush) / tot).toFixed(0)}%) ` +
        `before flush ${inst.ptsMid} (${((100 * inst.ptsMid) / tot).toFixed(0)}%, of which starved-cash ${inst.ptsStarved}); ` +
        `mid plays ${inst.midPlays} avg bagLeft ${(inst.midBagSum / Math.max(1, inst.midPlays)).toFixed(1)} | ` +
        `flush rack size hist (first flush call per match): ${inst.flushHist.map((c, i) => (c ? `${i}:${c}` : "")).filter(Boolean).join(" ")}`,
    );
  });
}

export class XBrain extends Brain {
  xp: XParams;
  forceExact = false;
  useStrongInPlan = 0; // ms cap, 0 = off

  constructor(d: Dict, xp: XParams) {
    super(d, xp);
    this.xp = xp;
    if (xp.instrument) hookExit();
  }

  plan(r: Rack, bagLeft: number, cands?: number[]) {
    const b = this.forceExact ? 1 : this.beta(bagLeft);
    const c = cands ?? this.dict.candidates(r);
    if (b >= 1 && this.useStrongInPlan > 0) {
      return strongPartition(this.dict, r, c, this.xp.bigBudget, this.useStrongInPlan);
    }
    const left = b >= 1 ? () => 0 : (x: Rack) => (1 - b) * this.hoard(x);
    if (this.xp.fastPlan) return fastPartition(this.dict, r, c, left, this.p.budget, b >= 1 ? 0 : this.xp.fastSlack);
    return bestPartition(this.dict, r, c, left, this.p.budget);
  }

  flushSeen = false;

  bid(v: View, letter: number): number {
    const xp = this.xp;
    const prevExact = this.forceExact;
    const prevStrong = this.useStrongInPlan;
    if (xp.exactGainAt > 0 && v.bagLeft <= xp.exactGainAt) this.forceExact = true;
    if (xp.strongBidAt > 0 && v.bagLeft <= xp.strongBidAt) this.useStrongInPlan = xp.strongBidMs;
    try {
      return super.bid(v, letter);
    } finally {
      this.forceExact = prevExact;
      this.useStrongInPlan = prevStrong;
    }
  }

  /** The final flush: exact-ish partition, with optional instrumentation. */
  flush(r: Rack): number[] {
    const xp = this.xp;
    const cands = this.dict.candidates(r);
    let strong: StrongResult | null = null;
    if (xp.solver === 1 || xp.instrument) strong = strongPartition(this.dict, r, cands, xp.bigBudget, xp.bigMs);
    let base: Partition | null = null;
    if (xp.solver === 0 || xp.instrument) {
      const t0 = performance.now();
      base = bestPartition(this.dict, r, cands, () => 0, xp.instrument ? xp.instBudget : this.p.budget);
      if (xp.instrument && strong) {
        const ms = performance.now() - t0;
        const n = rackSize(r);
        if (n >= 8) {
          const g = strong.wordScore - base.wordScore;
          inst.n++;
          inst.tiles += n;
          if (n >= 20) inst.bigRacks++;
          inst.gainSum += g;
          if (g > inst.gainMax) inst.gainMax = g;
          if (g > 0) inst.better++;
          if (g < 0) inst.worse++;
          inst.baseMs += ms;
          inst.strongMs += strong.ms;
          inst.strongNodes += strong.nodes;
          if (!strong.complete) inst.incomplete++;
          inst.baseScore += base.wordScore;
          inst.strongScore += strong.wordScore;
          if (process.env.INST_ROWS)
            inst.rows.push(
              `tiles=${n} cands=${cands.length} base=${base.wordScore} (${ms.toFixed(1)}ms) strong=${strong.wordScore} (${strong.ms.toFixed(1)}ms, ${strong.nodes} nodes, ${strong.complete ? "complete" : "CUT"}) gain=${g}`,
            );
        }
      }
    }
    if (xp.solver === 1 && strong) return strong.words;
    return base ? base.words : [];
  }

  words(v: View): number[] {
    const xp = this.xp;
    if (v.bagLeft <= this.p.flushAt && xp.instrument && !this.flushSeen) {
      this.flushSeen = true;
      inst.matches++;
      inst.flushHist[Math.min(39, rackSize(v.rack))]++;
    }
    if (rackSize(v.rack) < 2) return [];
    if (v.bagLeft <= this.p.flushAt) {
      const out = this.flush(v.rack);
      if (xp.instrument) for (const k of out) inst.ptsFlush += this.dict.rew[k];
      return out;
    }
    const ws = this.plan(v.rack, v.bagLeft).words;
    // Pre-flush: a few auctions before the end, play the long words now
    // (insurance against latency at the real flush; also frees cash).
    let out: number[];
    if (xp.preFlushAt > 0 && v.bagLeft <= xp.preFlushAt) {
      out = ws.filter((k) => this.dict.len[k] >= xp.preFlushLen);
    } else {
      const starved = v.balance < this.p.starveCash;
      const min = starved ? 5 : Math.min(this.p.minMidLen, xp.playNowLen);
      const r = this.p.midMinReward;
      out = ws.filter((k) => this.dict.len[k] >= min || (r > 0 && this.dict.rew[k] >= r));
      if (xp.instrument && starved) for (const k of out) inst.ptsStarved += this.dict.rew[k];
    }
    if (xp.instrument && out.length) {
      for (const k of out) inst.ptsMid += this.dict.rew[k];
      inst.midPlays++;
      inst.midBagSum += v.bagLeft;
    }
    return out;
  }
}

export function makePolicy(d: Dict, over: Partial<XParams>, _rnd: () => number): Policy & { letter: number; brain: XBrain } {
  const xp: XParams = { ...X_DEFAULTS, ...over };
  if (process.env.INSTRUMENT) xp.instrument = 1;
  const brain = new XBrain(d, xp);
  const pol = {
    brain,
    letter: 0,
    reset() {
      brain.flushSeen = false;
    },
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
