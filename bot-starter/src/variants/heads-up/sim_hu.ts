// Copy of src/sim.ts for small tables (heads-up final, 3/4-seat bracket rounds)
// with stronger heads-up opponents and per-player tiles/end-balance stats.
//
// Usage: node_modules/.bin/tsx src/variants/heads-up/sim_hu.ts [matches] [mix] [seed]
//   BRAIN_PARAMS='{"kappa":2}'  -> extra overrides for the "brain" player (6-seat keys + r1..r4 nested)
//   The "brain" player always uses paramsFor(nRivals, EXTRA), i.e. exactly what policy.ts does live.
//   "self" = the unmodified live bot (DEFAULT_PARAMS); "old" = previous parameter set.

import { BAG_COUNTS, Dict, FACE, type Rack, emptyRack, rackSize } from "../../engine.js";
import { Brain, DEFAULT_PARAMS, type Params } from "../../strategy.js";
import { paramsFor, type Over } from "./overrides.js";

export interface Player {
  name: string;
  rack: Rack;
  balance: number;
  score: number;
  tiles: number;
  isSim: boolean;
  bid(letter: number, bagLeft: number, firstPrice: boolean): number;
  tick(bagLeft: number): void;
  afterWin?(): void;
}

export let maxRival: (me: Player) => number = () => Infinity;

export class Game {
  constructor(
    public d: Dict,
    public rnd: () => number = Math.random,
  ) {}

  play(word: number, p: Player): boolean {
    if (!this.d.fits(word, p.rack)) return false;
    const o = word * 26;
    for (let i = 0; i < 26; i++) p.rack[i] -= this.d.counts[o + i];
    p.score += this.d.rew[word];
    p.balance += this.d.rew[word];
    return true;
  }

  longest(r: Rack, minLen: number): number | undefined {
    const c = this.d.candidates(r, minLen);
    let best: number | undefined;
    for (const k of c) if (best === undefined || this.d.len[k] > this.d.len[best]) best = k;
    return best;
  }

  run(players: Player[], firstPrice = false): number[] {
    const bag = BAG_COUNTS.slice();
    let total = 98;
    const draw = (): number | undefined => {
      if (total === 0) return undefined;
      let idx = Math.floor(this.rnd() * total);
      for (let i = 0; i < 26; i++) {
        if (idx < bag[i]) {
          bag[i]--;
          total--;
          return i;
        }
        idx -= bag[i];
      }
      return undefined;
    };
    for (const p of players) {
      p.rack = emptyRack();
      p.balance = 100;
      p.score = 0;
      p.tiles = 0;
      for (let n = 0; n < 5; n++) {
        const l = draw();
        if (l !== undefined) p.rack[l]++;
      }
    }
    let letter = draw();
    while (letter !== undefined) {
      for (const p of players) if (!p.isSim) p.tick(total);
      const bids: [Player, number][] = [];
      for (const p of players) {
        maxRival = (me: Player) => Math.max(...players.filter((x) => x !== me).map((x) => x.balance));
        const b = Math.min(p.balance, Math.max(0, Math.floor(p.bid(letter, total, firstPrice))));
        if (b > 0) bids.push([p, b]);
      }
      for (let i = bids.length - 1; i > 0; i--) {
        const j = Math.floor(this.rnd() * (i + 1));
        [bids[i], bids[j]] = [bids[j], bids[i]];
      }
      bids.sort((a, b) => b[1] - a[1]);
      if (bids.length > 0) {
        const [w, top] = bids[0];
        const paid = firstPrice ? top : bids.length > 1 ? bids[1][1] : Math.min(1, top);
        if (w.balance >= paid) {
          w.balance -= paid;
          w.rack[letter]++;
          w.tiles++;
          w.afterWin?.();
        }
      }
      letter = draw();
    }
    return players.map((p) => p.score);
  }
}

// ---------- opponents ----------

export function simBot(g: Game, kind: "cheap" | "value" | "aggr", name: string = kind): Player {
  return {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
    tiles: 0,
    isSim: true,
    bid(l) {
      const v = FACE[l];
      const vowel = "AEIOU".includes(String.fromCharCode(65 + l));
      const base = kind === "cheap" ? v - 1 : kind === "value" ? v : v + (vowel ? 4 : 2);
      const jitter = Math.floor(g.rnd() * 5) - 2;
      return Math.max(0, Math.min(Math.max(base + jitter, 1), this.balance));
    },
    tick() {},
    afterWin() {
      const w = g.longest(this.rack, 3);
      if (w !== undefined) g.play(w, this);
    },
  };
}

/** Bids ~mult x face (+1), holds for 7s, flushes at the end. mult=0 -> "bid 1 on everything and flush". */
export function greedyBot(g: Game, mult = 2, name = "greedy"): Player {
  return {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
    tiles: 0,
    isSim: false,
    bid(l, bagLeft) {
      if (bagLeft === 0) return 0;
      return Math.min(Math.round(FACE[l] * mult + 1), this.balance);
    },
    tick(bagLeft) {
      for (;;) {
        const w = g.longest(this.rack, bagLeft <= 1 ? 2 : 7);
        if (w === undefined || !g.play(w, this)) break;
      }
    },
  };
}

/** Live-field-like prices (~9 + 1.4 face, noisy), holds for 7s, flushes at the end. */
export function fieldBot(g: Game, scale = 1, name = "field"): Player {
  return {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
    tiles: 0,
    isSim: false,
    bid(l, bagLeft) {
      if (bagLeft === 0) return 0;
      const v = (9 + 1.4 * FACE[l]) * scale * (0.8 + 0.6 * g.rnd());
      return Math.min(Math.round(v), this.balance);
    },
    tick(bagLeft) {
      for (;;) {
        const w = g.longest(this.rack, bagLeft <= 1 ? 2 : 7);
        if (w === undefined || !g.play(w, this)) break;
      }
    },
  };
}

/** Field-like bot that paces itself for the table: bids ~balance / (tiles it still wants) x value weight. */
export function pacerBot(g: Game, aggr = 1, name = "pacer"): Player {
  return {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
    tiles: 0,
    isSim: false,
    bid(l, bagLeft) {
      if (bagLeft === 0) return 0;
      const want = Math.max(1, bagLeft * 0.55);
      const per = (this.balance / want) * aggr;
      const v = per * (0.6 + 0.15 * FACE[l]) * (0.8 + 0.4 * g.rnd());
      return Math.min(Math.max(1, Math.round(v)), this.balance);
    },
    tick(bagLeft) {
      for (;;) {
        const w = g.longest(this.rack, bagLeft <= 1 ? 2 : 7);
        if (w === undefined || !g.play(w, this)) break;
      }
    },
  };
}

// SIM_BUDGET lowers the partition-search budget for ALL brain players symmetrically
// (the shared box is too slow for budget 3000 on 40-tile heads-up racks).
const SIM_BUDGET = Number(process.env.SIM_BUDGET ?? DEFAULT_PARAMS.budget);
export function brainBot(g: Game, params: Params = DEFAULT_PARAMS, name = "brain"): Player {
  const brain = new Brain(g.d, { ...params, budget: SIM_BUDGET });
  return {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
    tiles: 0,
    isSim: false,
    bid(l, bagLeft, firstPrice) {
      return brain.bid({ rack: this.rack, balance: this.balance, bagLeft, firstPrice, maxRivalBalance: maxRival(this) }, l);
    },
    tick(bagLeft) {
      if (rackSize(this.rack) < 2) return;
      const ws = brain.words({ rack: this.rack, balance: this.balance, bagLeft, firstPrice: false });
      for (const w of ws) g.play(w, this);
    },
  };
}

// ---------- mixes ----------

export type Mix = (g: Game) => Player[];

const OLD: Params = { ...DEFAULT_PARAMS, kappa: 3, spendPerAuction: 3, alpha: 1.5, base: 3, friend: 1, cashMax: 3, horizon: 14, lateFillN: 0, lateMult: 1.3, minBid: 0 };
const LEAN: Params = { ...DEFAULT_PARAMS, marketFloor: 0, lateFillN: 0 }; // a rival that dropped the 6-seat floors
const EXTRA: Over = JSON.parse(process.env.BRAIN_PARAMS ?? "{}");
/** The player under test: live brain + rival-count-keyed overrides, exactly as policy.ts would do. */
const me = (g: Game, nRivals: number) => brainBot(g, paramsFor(nRivals, EXTRA), "brain");
const self = (g: Game) => brainBot(g, DEFAULT_PARAMS, "self");

export const MIXES: Record<string, Mix> = {
  // heads-up final (88 auctions)
  hu_self: (g) => [me(g, 1), self(g)],
  hu_old: (g) => [me(g, 1), brainBot(g, OLD, "old")],
  hu_lean: (g) => [me(g, 1), brainBot(g, LEAN, "lean")],
  hu_ones: (g) => [me(g, 1), greedyBot(g, 0, "ones")],
  hu_greedy: (g) => [me(g, 1), greedyBot(g, 2, "greedy2")],
  hu_greedy3: (g) => [me(g, 1), greedyBot(g, 3, "greedy3")],
  hu_field: (g) => [me(g, 1), fieldBot(g, 1, "field")],
  hu_fieldlo: (g) => [me(g, 1), fieldBot(g, 0.5, "field.5")],
  hu_pacer: (g) => [me(g, 1), pacerBot(g, 1, "pacer")],
  hu_cheap: (g) => [me(g, 1), simBot(g, "cheap", "cheap")],
  // 3 and 4 seats (83 / 78 auctions)
  three: (g) => [me(g, 2), brainBot(g, OLD, "old"), fieldBot(g, 1, "field")],
  three_self: (g) => [me(g, 2), self(g), fieldBot(g, 1, "field")],
  four: (g) => [me(g, 3), brainBot(g, OLD, "old"), fieldBot(g, 1, "field"), greedyBot(g, 3, "greedy3")],
  four_self: (g) => [me(g, 3), self(g), brainBot(g, OLD, "old"), fieldBot(g, 1, "field")],
  // 6 seats: overrides must be a no-op here (paramsFor(5) = live params)
  six: (g) => [me(g, 5), self(g), brainBot(g, OLD, "old"), fieldBot(g, 1, "field"), greedyBot(g, 2, "greedy2"), greedyBot(g, 3, "greedy3")],
};

export function evaluate(d: Dict, mix: Mix, matches: number, seed = 1) {
  let s = seed;
  const rnd = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = new Game(d, rnd);
  const stats = new Map<string, { score: number; place: number; wins: number; tiles: number; bal: number }>();
  const summ = (n: number) => {
    const out: Record<string, string> = {};
    for (const [k, v] of stats)
      out[k] = `score ${(v.score / n).toFixed(1)} place ${(v.place / n).toFixed(2)} win ${(v.wins / n).toFixed(2)} tiles ${(v.tiles / n).toFixed(1)} bal ${(v.bal / n).toFixed(0)}`;
    return out;
  };
  for (let m = 0; m < matches; m++) {
    const players = mix(g);
    const scores = g.run(players);
    players.forEach((p, i) => {
      const st = stats.get(p.name) ?? { score: 0, place: 0, wins: 0, tiles: 0, bal: 0 };
      const better = scores.filter((x) => x > scores[i]).length;
      st.score += scores[i];
      st.place += better + 1;
      if (better === 0) st.wins++;
      st.tiles += p.tiles;
      st.bal += p.balance;
      stats.set(p.name, st);
    });
    // running partial result (the box is slow; a partial line beats nothing)
    if ((m + 1) % 10 === 0 && m + 1 < matches)
      console.log(`  partial n=${m + 1} | ${Object.entries(summ(m + 1)).map(([a, b]) => `${a}: ${b}`).join(" | ")}`);
  }
  return summ(matches);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = Dict.load();
  const n = Number(process.argv[2] ?? 100);
  const which = process.argv[3] ? process.argv[3].split(",") : Object.keys(MIXES);
  const seed = Number(process.argv[4] ?? 1);
  for (const k of which) {
    const t0 = Date.now();
    const r = evaluate(d, MIXES[k], n, seed);
    console.log(`${k} n=${n} seed=${seed} BRAIN_PARAMS=${process.env.BRAIN_PARAMS ?? "{}"} | ${Object.entries(r).map(([a, b]) => `${a}: ${b}`).join(" | ")} (${Date.now() - t0}ms)`);
  }
}
