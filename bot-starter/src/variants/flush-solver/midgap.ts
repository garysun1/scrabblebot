// Mid-match plan gap: hoard objective (beta 0.5), base(3000) vs fast(3000) vs base(300k) on 16/20-tile racks.
//   node_modules/.bin/tsx src/variants/flush-solver/midgap.ts [racks=10]
import { BAG_COUNTS, Dict, bestPartition } from "../../engine.js";
import { mulberry } from "../../replay.js";
import { Brain, DEFAULT_PARAMS } from "../../strategy.js";
import { fastPartition } from "./policy.js";

const d = Dict.load();
const brain = new Brain(d, DEFAULT_PARAMS);
const hoard = (x: Int8Array) => 0.5 * brain.hoard(x);
const racks = Number(process.argv[2] ?? 10);
for (const tiles of [16, 20]) {
  const rnd = mulberry(3 + tiles);
  let sb = 0, sf = 0, sB = 0, mb = 0, mf = 0, mB = 0, diffWords = 0;
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
    let t0 = performance.now();
    const b = bestPartition(d, r, cands, hoard, 3000);
    mb += performance.now() - t0; sb += b.score;
    t0 = performance.now();
    const f = fastPartition(d, r, cands, hoard, 3000, 8);
    mf += performance.now() - t0; sf += f.score;
    t0 = performance.now();
    const B = bestPartition(d, r, cands, hoard, 300000);
    mB += performance.now() - t0; sB += B.score;
    if (b.words.join() !== B.words.join()) diffWords++;
  }
  console.log(`tiles=${tiles} racks=${racks}: hoard objective base(3000) ${(sb / racks).toFixed(1)} ${(mb / racks).toFixed(0)}ms | fast(3000) ${(sf / racks).toFixed(1)} ${(mf / racks).toFixed(0)}ms | base(300k) ${(sB / racks).toFixed(1)} ${(mB / racks).toFixed(0)}ms | plan differs 3000 vs 300k: ${diffWords}/${racks}`);
}
