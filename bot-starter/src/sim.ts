// Offline match simulator that mirrors the module's rules (spacetimedb/src/game.ts):
//  - 98-tile bag, each player dealt 5 hidden tiles at start
//  - one letter per auction; unbid tiles are discarded (not returned)
//  - Vickrey: winner pays runner-up bid, or min(1, bid) alone; ties random
//  - simulated bots play findBestPlayable(minLen 3) right after winning
//  - match ends the moment the last auction closes (no more plays)
//
// Usage: npx tsx src/sim.ts [matches] [mix]

import { BAG_COUNTS, Dict, FACE, type Rack, emptyRack, rackSize } from "./engine.js";
import { Brain, DEFAULT_PARAMS, type Params } from "./strategy.js";

export interface Player {
  name: string;
  rack: Rack;
  balance: number;
  score: number;
  isSim: boolean;
  bid(letter: number, bagLeft: number, firstPrice: boolean): number;
  /** called whenever the bot gets a chance to act (rack change / new auction) */
  tick(bagLeft: number): void;
  afterWin?(): void;
}

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

  /** Longest playable word (ties: first in reward order), like findBestPlayable. */
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
        const b = Math.min(p.balance, Math.max(0, Math.floor(p.bid(letter, total, firstPrice))));
        if (b > 0) bids.push([p, b]);
      }
      // shuffle then stable sort desc
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
  const p: Player = {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
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
  return p;
}

/** The repo's bot-starter: face+2 if we don't hold it, else face; plays the longest word on every rack change. */
export function starterBot(g: Game, name = "starter"): Player {
  return {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
    isSim: false,
    bid(l) {
      const v = FACE[l];
      return Math.min(this.rack[l] === 0 ? v + 2 : Math.max(1, v), this.balance);
    },
    tick() {
      for (;;) {
        const w = g.longest(this.rack, 2);
        if (w === undefined || !g.play(w, this)) break;
      }
    },
  };
}

/** A plausible competent rival: bids ~2x face, plays 7+ words as they appear, flushes at the end. */
export function greedyBot(g: Game, mult = 2, name = "greedy"): Player {
  return {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
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

/**
 * Modeled on the live field (Nov 2026): second prices ~10 for 1-point letters,
 * ~15 for 3-4 pointers, ~23 for J/X/Z. Bids around 9 + face, with noise,
 * plays 7+ letter words as they appear and flushes at the end.
 */
export function fieldBot(g: Game, scale = 1, name = "field"): Player {
  return {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
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

export function brainBot(g: Game, params: Params = DEFAULT_PARAMS, name = "brain"): Player {
  const brain = new Brain(g.d, params);
  return {
    name,
    rack: emptyRack(),
    balance: 100,
    score: 0,
    isSim: false,
    bid(l, bagLeft, firstPrice) {
      return brain.bid({ rack: this.rack, balance: this.balance, bagLeft, firstPrice }, l);
    },
    tick(bagLeft) {
      if (rackSize(this.rack) < 2) return;
      const ws = brain.words({ rack: this.rack, balance: this.balance, bagLeft, firstPrice: false });
      for (const w of ws) g.play(w, this);
    },
  };
}

// ---------- tournament-ish evaluation ----------

export type Mix = (g: Game) => Player[];

export const MIXES: Record<string, Mix> = {
  // A lobby padded with house sims.
  sims: (g) => {
    const kinds = ["cheap", "value", "aggr", "value", "aggr", "cheap"] as const;
    return [brainBot(g), ...kinds.slice(0, 5).map((k, i) => simBot(g, k, `${k}${i}`))];
  },
  starters: (g) => [
    brainBot(g),
    starterBot(g, "starter1"),
    starterBot(g, "starter2"),
    starterBot(g, "starter3"),
    simBot(g, "aggr"),
    simBot(g, "value"),
  ],
  rivals: (g) => [
    brainBot(g),
    greedyBot(g, 2, "greedy2x"),
    greedyBot(g, 3, "greedy3x"),
    starterBot(g, "starter1"),
    starterBot(g, "starter2"),
    simBot(g, "aggr"),
  ],
};

export function evaluate(d: Dict, mix: Mix, matches: number, seed = 1) {
  let s = seed;
  const rnd = () => {
    // mulberry32
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = new Game(d, rnd);
  const stats = new Map<string, { score: number; place: number; wins: number }>();
  for (let m = 0; m < matches; m++) {
    const players = mix(g);
    // random seating doesn't matter (ties are shuffled), but shuffle names anyway
    const scores = g.run(players);
    players.forEach((p, i) => {
      const st = stats.get(p.name) ?? { score: 0, place: 0, wins: 0 };
      const better = scores.filter((x) => x > scores[i]).length;
      st.score += scores[i];
      st.place += better + 1;
      if (better === 0) st.wins++;
      stats.set(p.name, st);
    });
  }
  const out: Record<string, { score: number; place: number; win: number }> = {};
  for (const [k, v] of stats)
    out[k] = {
      score: +(v.score / matches).toFixed(1),
      place: +(v.place / matches).toFixed(2),
      win: +(v.wins / matches).toFixed(2),
    };
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = Dict.load();
  const n = Number(process.argv[2] ?? 100);
  const which = process.argv[3] ? [process.argv[3]] : Object.keys(MIXES);
  for (const k of which) {
    const t0 = Date.now();
    console.log(k, evaluate(d, MIXES[k], n), `${Date.now() - t0}ms`);
  }
}
