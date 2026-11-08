// Correctness check: on small racks where every search completes, strong/fast must equal bestPartition.
//   node_modules/.bin/tsx src/variants/flush-solver/check.ts [tiles=11] [racks=150]
import { BAG_COUNTS, Dict, bestPartition, rackToString } from "../../engine.js";
import { mulberry } from "../../replay.js";
import { Brain, DEFAULT_PARAMS } from "../../strategy.js";
import { fastPartition, strongPartition } from "./policy.js";

const d = Dict.load();
const brain = new Brain(d, DEFAULT_PARAMS);
const hoard = (x: Int8Array) => 0.5 * brain.hoard(x);
const tiles = Number(process.argv[2] ?? 11);
const racks = Number(process.argv[3] ?? 150);
const rnd = mulberry(11);
let bad = 0, badH = 0, fastWorseH = 0, fastBetterH = 0;
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
  const b = bestPartition(d, r, cands, () => 0, 5_000_000);
  const s = strongPartition(d, r, cands, 5_000_000, 20000);
  const f = fastPartition(d, r, cands, () => 0, 5_000_000, 0);
  if (b.wordScore !== s.wordScore || b.wordScore !== f.wordScore || !s.complete) {
    bad++;
    console.log(`MISMATCH ${rackToString(r)} base=${b.wordScore} strong=${s.wordScore}${s.complete ? "" : "(cut)"} fast=${f.wordScore}`);
  }
  // hoard state: base bound is heuristic too, so only report direction
  const bh = bestPartition(d, r, cands, hoard, 5_000_000);
  const fh = fastPartition(d, r, cands, hoard, 5_000_000, 8);
  if (Math.abs(bh.score - fh.score) > 1e-9) {
    badH++;
    if (fh.score < bh.score) fastWorseH++; else fastBetterH++;
  }
}
console.log(`tiles=${tiles} racks=${racks}: leftover-0 mismatches ${bad}; hoard-state differences ${badH} (fast worse ${fastWorseH}, fast better ${fastBetterH})`);
