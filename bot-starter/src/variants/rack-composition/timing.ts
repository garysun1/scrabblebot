// Timing + calibration: time bid() on big racks and print the dC magnitudes.
// Run: /home/user/scrabblebot/bot-starter/node_modules/.bin/tsx src/variants/rack-composition/timing.ts
import { Dict, LETTERS, rackFromMap } from "../../engine.js";
import { CBrain, C_DEFAULTS } from "./policy.js";

const d = Dict.load();
const brain = new CBrain(d, { ...C_DEFAULTS, cw: 4 });
function rack(s: string) {
  const m = new Map<string, number>();
  for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1);
  return rackFromMap(m);
}
const unseen = Int8Array.from([7, 2, 2, 3, 9, 1, 2, 2, 7, 1, 1, 3, 2, 5, 6, 2, 1, 4, 3, 4, 3, 2, 2, 1, 2, 1]);
for (const [name, s, bag] of [
  ["5-tile", "AEINR", 60],
  ["12-tile", "AEEINRSTLOGD", 40],
  ["20-tile", "AAEEIINNRRSSTTLOGDUC", 30],
  ["28-tile", "AAAEEEIIINNRRSSTTLLOOGDUCMPBH", 20],
] as [string, string, number][]) {
  const r = rack(s);
  const t0 = performance.now();
  let n = 0;
  const bids: number[] = [];
  for (let rep = 0; rep < 3; rep++) {
    for (let L = 0; L < 26; L++) {
      bids.push(brain.bid({ rack: r, balance: 60, bagLeft: bag, firstPrice: false, unseen }, L));
      n++;
    }
  }
  const ms = (performance.now() - t0) / n;
  const t1 = performance.now();
  for (let L = 0; L < 26; L++) brain.completability(r, L, unseen, bag - 1);
  const cms = (performance.now() - t1) / 26;
  const dcs = LETTERS.split("").map((ch, L) => {
    const [w, o] = brain.completability(r, L, unseen, bag - 1);
    return `${ch}:${(w - o).toFixed(2)}`;
  });
  console.log(`${name} rack ${s} bagLeft ${bag}: bid ${ms.toFixed(2)} ms/call, completability ${cms.toFixed(2)} ms/call, survivors ${brain.lastScan}`);
  console.log(`  C(rack) ~ ${brain.completability(r, 0, unseen, bag - 1)[1].toFixed(2)}  dC: ${dcs.join(" ")}`);
  console.log(`  bids(cw=4): ${bids.slice(0, 26).join(",")}`);
}
