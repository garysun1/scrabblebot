// Cross-entropy search over the 12-entry group x phase multiplier table.
//   cd bot-starter && REPLAY_FILE=./replay_hack.json REPLAY_SPLIT=train REPLAY_SEEDS=2 \
//     ./node_modules/.bin/tsx src/variants/group-phase-multipliers/cem.ts [gens=4] [pop=10] [workers=3]
// Init: all entries 1.0, sd 0.15; clamp [0.3, 3]; elite = pop/3. Runs <= `workers`
// replay processes at once (other agents share the 4 CPUs). Every candidate's
// replay line is appended to cem.log next to this file.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KEYS = ["v", "c1", "c24", "c5"].flatMap((g) => ["e", "m", "l"].map((p) => `${g}_${p}`));
type P = Record<string, number>;
const gens = Number(process.argv[2] ?? 4);
const pop = Number(process.argv[3] ?? 10);
const workers = Number(process.argv[4] ?? 3);
const elite = Math.max(2, Math.floor(pop / 3));
const SD0 = Number(process.env.CEM_SD0 ?? 0.15);
const LO = 0.3, HI = 3.0;
const SEED = process.env.CEM_SEED ?? "5";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url)); // bot-starter/
const LOG = fileURLToPath(new URL("./cem.log", import.meta.url));
const log = (s: string) => { console.log(s); appendFileSync(LOG, s + "\n"); };

let s = Number(process.env.CEM_RNG ?? 12345);
const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const clamp = (v: number) => +Math.max(LO, Math.min(HI, v)).toFixed(3);

function evalOne(p: P): Promise<{ score: number; line: string }> {
  return new Promise((res) => {
    const child = spawn(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "src/replay.ts", "x", "200", SEED, JSON.stringify(p)], {
      cwd: ROOT,
      env: {
        ...process.env,
        QUIET: "1",
        REPLAY_POLICY: "./variants/group-phase-multipliers/policy.ts",
        REPLAY_SEEDS: process.env.REPLAY_SEEDS ?? "2",
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => {
      const m = out.match(/avg place ([\d.]+)/);
      const line = out.trim().split("\n").pop() ?? err.trim().split("\n").pop() ?? "(no output)";
      res({ score: m ? Number(m[1]) : 9, line });
    });
  });
}
async function evalAll(ps: P[]): Promise<number[]> {
  const out = new Array<number>(ps.length).fill(9);
  let next = 0;
  const worker = async () => {
    while (next < ps.length) {
      const i = next++;
      const r = await evalOne(ps[i]);
      out[i] = r.score;
      log(`  cand ${i}: ${r.line}`);
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

(async () => {
  const mean: P = {}; const sd: P = {};
  for (const k of KEYS) { mean[k] = 1.0; sd[k] = SD0; }
  log(`=== CEM start ${new Date().toISOString()} gens=${gens} pop=${pop} elite=${elite} workers=${workers} seed=${SEED} REPLAY_SEEDS=${process.env.REPLAY_SEEDS ?? "2"} SPLIT=${process.env.REPLAY_SPLIT} FILE=${process.env.REPLAY_FILE}`);
  const base = await evalOne({});
  log(`baseline (all 1.0) on this pool: ${base.line}`);
  let best: { p: P; score: number } = { p: {}, score: base.score };
  for (let g = 0; g < gens; g++) {
    const cands: P[] = [];
    for (let i = 0; i < pop; i++) {
      const p: P = {};
      for (const k of KEYS) p[k] = clamp(mean[k] + sd[k] * gauss());
      cands.push(p);
    }
    log(`--- gen ${g} ${new Date().toISOString()}`);
    const scores = await evalAll(cands);
    const order = cands.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
    const top = order.slice(0, elite);
    for (const k of KEYS) {
      const xs = top.map((i) => cands[i][k]);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
      mean[k] = m; sd[k] = Math.max(Math.sqrt(v), SD0 * 0.15);
    }
    if (scores[order[0]] < best.score) best = { p: cands[order[0]], score: scores[order[0]] };
    log(`gen ${g}: best ${scores[order[0]]} elite mean ${(top.reduce((a, i) => a + scores[i], 0) / elite).toFixed(3)} all mean ${(scores.reduce((a, b) => a + b, 0) / pop).toFixed(3)} | mean ${JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, clamp(mean[k])])))} | sd ${JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, +sd[k].toFixed(3)])))}`);
  }
  const final = Object.fromEntries(KEYS.map((k) => [k, clamp(mean[k])]));
  const fs = await evalOne(final);
  log(`FINAL mean ${JSON.stringify(final)} -> ${fs.line}`);
  log(`BEST single ${JSON.stringify(best.p)} -> ${best.score}`);
  log(`=== CEM end ${new Date().toISOString()}`);
})();
