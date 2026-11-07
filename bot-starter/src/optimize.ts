// Cross-entropy search over v1 params against a replay pool.
//   REPLAY_FILE=./replay_hack.json REPLAY_SPLIT=train ./node_modules/.bin/tsx src/optimize.ts [gens=6] [pop=12]
// Runs 4 replay processes in parallel; prints the elite mean each generation.
import { spawn } from "node:child_process";
import { DEFAULT_PARAMS } from "./strategy.js";

type P = Record<string, number>;
const SPACE: Record<string, [number, number, number]> = {
  // name: [initial mean, initial sd, min]
  kappa: [3, 0.6, 1],
  lateMult: [1.3, 0.25, 0.8],
  horizon: [14, 4, 4],
  alpha: [1.5, 0.5, 0.3],
  base: [3, 1, 0],
  vowelPen: [2.5, 0.8, 0],
  dupPen: [1.5, 0.6, 0],
  friend: [1, 0.5, 0],
  faceFriend: [0.5, 0.25, 0],
  spendPerAuction: [3, 1, 0.5],
  cashMax: [3, 0.7, 1],
  minMidLen: [7, 0.7, 5],
  starveCash: [15, 6, 0],
  lateFillN: [6, 5, 0],
  lateFill: [10, 3, 4],
};
const INT = new Set(["horizon", "minMidLen", "lateFillN"]);
const gens = Number(process.argv[2] ?? 6);
const pop = Number(process.argv[3] ?? 12);
const elite = Math.max(2, Math.floor(pop / 3));
let s = 12345;
const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

function evalOne(p: P): Promise<number> {
  return new Promise((res) => {
    const child = spawn(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "src/replay.ts", "v1", "200", "5", JSON.stringify(p)], {
      env: { ...process.env, QUIET: "1", REPLAY_SEEDS: process.env.REPLAY_SEEDS ?? "4" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => {
      const m = out.match(/avg place ([\d.]+)/);
      res(m ? Number(m[1]) : 9);
    });
  });
}
async function evalAll(ps: P[]): Promise<number[]> {
  const out = new Array<number>(ps.length).fill(9);
  let next = 0;
  const worker = async () => {
    while (next < ps.length) {
      const i = next++;
      out[i] = await evalOne(ps[i]);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}
const mean: P = {}; const sd: P = {};
for (const [k, [m, d]] of Object.entries(SPACE)) { mean[k] = m; sd[k] = d; }
const clamp = (k: string, v: number) => { const lo = SPACE[k][2]; let x = Math.max(lo, v); if (INT.has(k)) x = Math.round(x); return +x.toFixed(3); };
let best: { p: P; score: number } = { p: { ...DEFAULT_PARAMS } as unknown as P, score: 9 };
(async () => {
  const base = await evalOne({});
  console.log(`defaults on this pool: ${base}`);
  best = { p: {}, score: base };
  for (let g = 0; g < gens; g++) {
    const cands: P[] = [];
    for (let i = 0; i < pop; i++) {
      const p: P = {};
      for (const k of Object.keys(SPACE)) p[k] = clamp(k, mean[k] + sd[k] * gauss());
      cands.push(p);
    }
    const scores = await evalAll(cands);
    const order = cands.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
    const top = order.slice(0, elite);
    for (const k of Object.keys(SPACE)) {
      const xs = top.map((i) => cands[i][k]);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
      mean[k] = m; sd[k] = Math.max(Math.sqrt(v), SPACE[k][1] * 0.15);
    }
    if (scores[order[0]] < best.score) best = { p: cands[order[0]], score: scores[order[0]] };
    console.log(`gen ${g}: best ${scores[order[0]]} elite mean ${(top.reduce((a, i) => a + scores[i], 0) / elite).toFixed(3)} | mean ${JSON.stringify(Object.fromEntries(Object.entries(mean).map(([k, v]) => [k, clamp(k, v)])))}`);
  }
  const final = Object.fromEntries(Object.entries(mean).map(([k, v]) => [k, clamp(k, v)]));
  const fs = await evalOne(final);
  console.log(`FINAL mean ${JSON.stringify(final)} -> ${fs}`);
  console.log(`BEST single ${JSON.stringify(best.p)} -> ${best.score}`);
})();
