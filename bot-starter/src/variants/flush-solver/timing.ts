// Times the strong solver vs bestPartition on big random racks (bag draws).
//   node_modules/.bin/tsx src/variants/flush-solver/timing.ts [tiles=28] [racks=20]
import { BAG_COUNTS, Dict, bestPartition, rackToString } from "../../engine.js";
import { mulberry } from "../../replay.js";
import { fastPartition, strongPartition } from "./policy.js";
import { Brain, DEFAULT_PARAMS } from "../../strategy.js";
const brain = new Brain(Dict.load(), DEFAULT_PARAMS);
const hoard = (x: Int8Array) => 0.5 * brain.hoard(x); // a mid-match leftover (beta = 0.5)
let msFast = 0, sumFast = 0, msBaseH = 0, msFastH = 0, sumBaseH = 0, sumFastH = 0;

const d = Dict.load();
const tiles = Number(process.argv[2] ?? 28);
const racks = Number(process.argv[3] ?? 20);
const rnd = mulberry(7);
let sumBase = 0, sumStrong = 0, msBase = 0, msStrong = 0, cut = 0, maxMs = 0, maxCands = 0;
for (let n = 0; n < racks; n++) {
  const pool = Int8Array.from(BAG_COUNTS);
  const r = new Int8Array(26);
  for (let t = 0; t < tiles; t++) {
    let total = 0;
    for (let i = 0; i < 26; i++) total += pool[i];
    let idx = Math.floor(rnd() * total);
    for (let i = 0; i < 26; i++) {
      if (idx < pool[i]) { pool[i]--; r[i]++; break; }
      idx -= pool[i];
    }
  }
  const cands = d.candidates(r);
  maxCands = Math.max(maxCands, cands.length);
  let t0 = performance.now();
  const b = bestPartition(d, r, cands, () => 0, 3000);
  const tb = performance.now() - t0;
  t0 = performance.now();
  const s = strongPartition(d, r, cands, 400000, 250);
  const ts = performance.now() - t0;
  sumBase += b.wordScore; sumStrong += s.wordScore; msBase += tb; msStrong += ts; if (!s.complete) cut++; maxMs = Math.max(maxMs, ts);
  t0 = performance.now();
  const f = fastPartition(d, r, cands, () => 0, 3000, 0);
  msFast += performance.now() - t0; sumFast += f.wordScore;
  t0 = performance.now();
  const bh = bestPartition(d, r, cands, hoard, 3000);
  msBaseH += performance.now() - t0; sumBaseH += bh.score;
  t0 = performance.now();
  const fh = fastPartition(d, r, cands, hoard, 3000, 8);
  msFastH += performance.now() - t0; sumFastH += fh.score;
  console.log(`${rackToString(r)} cands=${cands.length} base=${b.wordScore} (${tb.toFixed(0)}ms) strong=${s.wordScore} (${ts.toFixed(0)}ms, ${s.nodes} nodes${s.complete ? "" : ", CUT"}) words=${s.words.map((k) => d.word[k]).join(" ")}`);
}
console.log(`fast(3000, leftover 0) avg ${(sumFast / racks).toFixed(1)} pts ${(msFast / racks).toFixed(0)}ms | hoard state: base(3000) avg ${(sumBaseH / racks).toFixed(1)} ${(msBaseH / racks).toFixed(0)}ms vs fast(3000) avg ${(sumFastH / racks).toFixed(1)} ${(msFastH / racks).toFixed(0)}ms`);
console.log(`tiles=${tiles} racks=${racks}: base avg ${(sumBase / racks).toFixed(1)} pts ${(msBase / racks).toFixed(0)}ms | strong avg ${(sumStrong / racks).toFixed(1)} pts ${(msStrong / racks).toFixed(0)}ms (max ${maxMs.toFixed(0)}ms, cut ${cut}/${racks}) maxCands=${maxCands}`);
