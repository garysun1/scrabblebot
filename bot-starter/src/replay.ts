// Replay arena: run a policy as a ghost 7th seat inside archived live matches.
//
// For every auction we know the letter, the real winning bid (top) and the
// price paid. The ghost bids; if it beats the top bid it wins the tile and
// pays the top bid (Vickrey), and the real winner loses that tile. If it
// loses, the real winner may have been pushed to pay more. Rival scores are
// adjusted for both effects (an approximation; it can't replay their word
// choices). Unlike self-play, the opponents here are LUCENT, Bron, StickBot
// and friends bidding as they actually did.
//
//   npx tsx src/replay.ts v2 [matches=80] [seed=1] ['{"param":value}']
//   npx tsx src/replay.ts v1 ...

import { readFileSync } from "node:fs";
import { BAG_COUNTS, Dict, type Rack, emptyRack } from "./engine.js";
import { Brain2, DEFAULT_PARAMS2, type Params2, type State, unseenPool } from "./brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "./strategy.js";

interface MatchRec {
  id: number;
  auctions: [string, number, number, number][]; // letter, top, paid, winnerBotId
  closes: number[];
  plays: [number, number, string][]; // t, botId, word
  scores: [number, number][]; // botId, score
}

export interface Policy {
  reset(): void;
  bid(s: State): number; // letter is in s via currentLetter
  words(s: State): number[];
  observePrice(s: State, letter: number, paid: number, weWon: boolean): void;
}

export function mulberry(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function v2Policy(d: Dict, p: Params2, rnd: () => number): Policy & { brain: Brain2; letter: number } {
  const brain = new Brain2(d, p);
  brain.rnd = rnd;
  let heat = p.heat0;
  let since = 99;
  const pol = {
    brain,
    letter: 0,
    reset() {
      heat = p.heat0;
      since = 99;
      brain.lambda = 0.5;
    },
    bid(s: State) {
      s.heat = heat;
      if (since >= 2) {
        brain.refreshLambda(s);
        since = 0;
      }
      since++;
      return brain.bid(s, pol.letter);
    },
    words(s: State) {
      s.heat = heat;
      return brain.words(s);
    },
    observePrice(s: State, letter: number, paid: number) {
      if (paid <= 0) return;
      const ref = brain.row(letter, brain.phase(s)).medSecond || 7;
      const ratio = Math.max(0.3, Math.min(3, paid / ref));
      heat = heat * (1 - p.heatWeight) + ratio * p.heatWeight;
    },
  };
  return pol;
}

export function v1Policy(d: Dict, p: Params): Policy & { letter: number } {
  const brain = new Brain(d, p);
  const pol = {
    letter: 0,
    reset() {},
    bid(s: State) {
      return brain.bid(
        { rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice, maxRivalBalance: s.maxRivalBalance },
        pol.letter,
      );
    },
    words(s: State) {
      return brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
    },
    observePrice() {},
  };
  return pol;
}

export interface ReplayResult {
  place: number;
  score: number;
  spent: number;
  letters: number;
  endBal: number;
  rivals: number[];
}

export function replayMatch(d: Dict, m: MatchRec, pol: Policy & { letter: number }, rnd: () => number): ReplayResult {
  pol.reset();
  const N = m.auctions.length;
  // Our starting rack: 5 tiles from what was never auctioned (rivals' deals).
  const pool = Int8Array.from(BAG_COUNTS);
  for (const [l] of m.auctions) pool[l.charCodeAt(0) - 65]--;
  const rack = emptyRack();
  const ourTiles = emptyRack();
  let poolTotal = 0;
  for (let i = 0; i < 26; i++) poolTotal += Math.max(0, pool[i]);
  for (let n = 0; n < 5; n++) {
    let idx = Math.floor(rnd() * poolTotal);
    for (let i = 0; i < 26; i++) {
      const c = Math.max(0, pool[i]);
      if (idx < c) {
        pool[i]--;
        poolTotal--;
        rack[i]++;
        ourTiles[i]++;
        break;
      }
      idx -= c;
    }
  }
  const auctioned = emptyRack();
  const rivalPlayed = emptyRack();
  const rivalWon = emptyRack();
  const stolen = new Map<number, number>();
  const won = new Map<number, number>();
  const drain = new Map<number, number>();
  for (const [, , , w] of m.auctions) if (w >= 0) won.set(w, (won.get(w) ?? 0) + 1);
  let balance = 100;
  let score = 0;
  let spent = 0;
  let letters = 0;
  let pi = 0; // plays pointer
  const rivalBal = new Map<number, number>(m.scores.map(([b]) => [b, 100]));

  const stateAt = (bagLeft: number): State => ({
    rack,
    balance,
    bagLeft,
    totalAuctions: N,
    unseen: unseenPool(ourTiles, auctioned, rivalPlayed, rivalWon),
    firstPrice: false,
    maxRivalBalance: Math.max(...rivalBal.values()),
    heat: 1,
    rivals: [...rivalBal].map(([id, balance]) => ({ id, balance })),
  });

  const play = (bagLeft: number) => {
    for (let guard = 0; guard < 6; guard++) {
      const ws = pol.words(stateAt(bagLeft));
      if (ws.length === 0) break;
      let any = false;
      for (const k of ws) {
        if (!d.fits(k, rack)) continue;
        const o = k * 26;
        for (let i = 0; i < 26; i++) rack[i] -= d.counts[o + i];
        score += d.rew[k];
        balance += d.rew[k];
        any = true;
      }
      if (!any) break;
    }
  };

  for (let i = 0; i < N; i++) {
    const [ls, top, paid, winner] = m.auctions[i];
    const letter = ls.charCodeAt(0) - 65;
    const bagLeft = N - 1 - i;
    // Rivals' plays up to this auction's close reveal hidden tiles.
    while (pi < m.plays.length && m.plays[pi][0] <= m.closes[i]) {
      const [, , word] = m.plays[pi++];
      for (const c of word) rivalPlayed[c.charCodeAt(0) - 65]++;
    }
    play(bagLeft);
    const s = stateAt(bagLeft);
    pol.letter = letter;
    const b = Math.min(balance, Math.max(0, Math.round(pol.bid(s))));
    auctioned[letter]++;
    let weWon = false;
    if (b >= 1 && (b > top || (b === top && rnd() < 0.5))) {
      weWon = true;
      const pay = top > 0 ? top : 1;
      balance -= pay;
      spent += pay;
      letters++;
      rack[letter]++;
      ourTiles[letter]++;
      if (winner >= 0) {
        stolen.set(winner, (stolen.get(winner) ?? 0) + 1);
        rivalBal.set(winner, (rivalBal.get(winner) ?? 100) + paid); // they keep their coins
      }
      pol.observePrice(s, letter, pay, true);
    } else {
      if (winner >= 0) {
        rivalWon[letter]++;
        const extra = Math.max(0, b - paid);
        drain.set(winner, (drain.get(winner) ?? 0) + extra);
        rivalBal.set(winner, (rivalBal.get(winner) ?? 100) - paid - extra);
      }
      pol.observePrice(s, letter, paid, false);
    }
  }
  play(0);
  const rivals = m.scores.map(([b, sc]) => {
    const w = won.get(b) ?? 0;
    const st = stolen.get(b) ?? 0;
    const dr = drain.get(b) ?? 0;
    const keep = w ? Math.max(0, (w - st) / w) : 1;
    return Math.max(0, sc * Math.sqrt(keep) - 0.5 * dr);
  });
  const place = 1 + rivals.filter((x) => x > score).length;
  return { place, score, spent, letters, endBal: balance, rivals };
}

export function loadMatches(): MatchRec[] {
  return JSON.parse(readFileSync(new URL("./replay_data.json", import.meta.url), "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = Dict.load();
  const which = process.argv[2] ?? "v2";
  const n = Number(process.argv[3] ?? 80);
  const seed = Number(process.argv[4] ?? 1);
  const over = JSON.parse(process.argv[5] ?? "{}");
  // Optional filters: REPLAY_MIN_ID=42700 REPLAY_REAL=1 (no house sims at the table)
  const SIMS = new Set([1, 2, 3, 4, 5, 6].map(BigInt).map(Number));
  const minId = Number(process.env.REPLAY_MIN_ID ?? 0);
  const all = loadMatches().filter(
    (m) => m.id >= minId && (!process.env.REPLAY_REAL || !m.scores.some(([b]) => SIMS.has(b))),
  );
  console.log(`replay pool: ${all.length} matches`);
  const rnd = mulberry(seed);
  // deterministic subset
  const idx = all.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, n);
  const pol =
    which === "v1"
      ? v1Policy(d, { ...DEFAULT_PARAMS, ...over })
      : v2Policy(d, { ...DEFAULT_PARAMS2, ...over }, rnd);
  let P = 0, S = 0, W = 0, B = 0, Lt = 0, N = 0;
  const t0 = Date.now();
  const hist = new Array(8).fill(0);
  const seeds = Number(process.env.REPLAY_SEEDS ?? 1);
  for (let k = 0; k < seeds; k++) {
    for (const i of idx) {
      const r = replayMatch(d, all[i], pol, mulberry(seed * 7919 + k * 104729 + i));
      P += r.place; S += r.score; W += r.place === 1 ? 1 : 0; B += r.endBal; Lt += r.letters; N++;
      hist[r.place]++;
    }
  }
  console.log(
    `${which} ${JSON.stringify(over)} n=${N}: avg place ${(P / N).toFixed(2)} score ${(S / N).toFixed(1)} ` +
      `win ${(W / N).toFixed(2)} letters ${(Lt / N).toFixed(1)} endbal ${(B / N).toFixed(0)} places[1..7]=${hist.slice(1).join(",")} (${((Date.now() - t0) / N).toFixed(0)}ms/match)`,
  );
}
