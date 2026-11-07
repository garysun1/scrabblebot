// Side-by-side trace of v1 and v2 on the same replay matches.
//   REPLAY_MIN_ID=42600 REPLAY_REAL=1 npx tsx src/trace.ts [matches=30] [seed=5]
import { Dict, FACE, LETTERS } from "./engine.js";
import { DEFAULT_PARAMS2 } from "./brain2.js";
import { DEFAULT_PARAMS } from "./strategy.js";
import { loadMatches, mulberry, replayMatch, v1Policy, v2Policy } from "./replay.js";

const d = Dict.load();
const n = Number(process.argv[2] ?? 30);
const seed = Number(process.argv[3] ?? 5);
const SIMS = new Set([1, 2, 3, 4, 5, 6]);
const minId = Number(process.env.REPLAY_MIN_ID ?? 0);
const all = loadMatches().filter((m) => m.id >= minId && (!process.env.REPLAY_REAL || !m.scores.some(([b]) => SIMS.has(b))));
const rnd0 = mulberry(seed);
const idx = all.map((_, i) => i).sort(() => rnd0() - 0.5).slice(0, n);

type Agg = { letters: number; spent: number; score: number; vow: number; hi: number; words: Record<number, number>; wordPts: Record<number, number>; byPhase: number[]; unplayedTiles: number; place: number };
function run(which: "v1" | "v2"): Agg {
  const a: Agg = { letters: 0, spent: 0, score: 0, vow: 0, hi: 0, words: {}, wordPts: {}, byPhase: [0, 0, 0, 0], unplayedTiles: 0, place: 0 };
  for (const i of idx) {
    const rnd = mulberry(seed * 1000 + i);
    const pol = which === "v1" ? v1Policy(d, DEFAULT_PARAMS) : v2Policy(d, DEFAULT_PARAMS2, rnd);
    const m = all[i];
    const bought: string[] = [];
    const played: { word: string; at: number }[] = [];
    // instrument: wrap bid/words
    const origBid = pol.bid.bind(pol);
    const origWords = pol.words.bind(pol);
    let lastBag = 99;
    pol.bid = (s) => { lastBag = s.bagLeft; return origBid(s); };
    pol.words = (s) => { const w = origWords(s); for (const k of w) played.push({ word: d.word[k], at: s.bagLeft }); return w; };
    const r = replayMatch(d, m, pol, rnd);
    a.place += r.place; a.letters += r.letters; a.spent += r.spent; a.score += r.score;
    for (const p of played) {
      const L = Math.min(p.word.length, 8);
      a.words[L] = (a.words[L] ?? 0) + 1;
      const rew = d.rew[d.candidates(Int8Array.from(d.counts.slice(0)) as any, 2)[0] ?? 0] ; // placeholder not used
      const ph = p.at > 40 ? 0 : p.at > 15 ? 1 : p.at > 1 ? 2 : 3;
      a.byPhase[ph]++;
    }
    void lastBag; void bought;
  }
  return a;
}
for (const which of ["v1", "v2"] as const) {
  const a = run(which);
  console.log(which, `place ${(a.place / n).toFixed(2)} score ${(a.score / n).toFixed(1)} letters ${(a.letters / n).toFixed(1)} spent ${(a.spent / n).toFixed(0)} pts/letter ${(a.score / a.letters).toFixed(1)} pts/coin ${(a.score / a.spent).toFixed(2)}`,
    "words by len", Object.entries(a.words).map(([k, v]) => `${k}:${(v / n).toFixed(1)}`).join(" "),
    "plays by bag(>40,15-40,2-15,<=1)", a.byPhase.map((x) => (x / n).toFixed(1)).join("/"));
}
