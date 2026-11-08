// Times bid() on big racks for the stem-potential brain.
// Run from bot-starter/:  node_modules/.bin/tsx src/variants/stem-potential/time_bid.ts
import { Dict, BAG_COUNTS, emptyRack } from "../../engine.js";
import { Brain, DEFAULT_PARAMS } from "./strategy.js";

const d = Dict.load();
const racks: Record<string, string> = {
  r20: "AAEEIOUBCDGLMNRSTTRS",
  r25: "AAEEEIIOUBCDGHLMNPRSTTRSZ",
  r28: "AAEEEIIOOUBCDGHLMNNPRSTTRSZK",
};
function rackOf(s: string) {
  const r = emptyRack();
  for (const ch of s) r[ch.charCodeAt(0) - 65]++;
  return r;
}
for (const [name, s] of Object.entries(racks)) {
  const rack = rackOf(s);
  const unseen = Int8Array.from(BAG_COUNTS);
  for (let i = 0; i < 26; i++) unseen[i] = Math.max(0, unseen[i] - rack[i]);
  for (const cfg of [
    { potW: 0, hoardW: 1 },
    { potW: 1, hoardW: 0.6 },
    { potW: 1, hoardW: 0 },
  ]) {
    const b = new Brain(d, { ...DEFAULT_PARAMS, ...cfg });
    // warm up
    for (let L = 0; L < 26; L++) b.bid({ rack, balance: 60, bagLeft: 40, firstPrice: false, unseen }, L);
    b.potCalls = 0;
    b.potMs = 0;
    const t0 = performance.now();
    const reps = 3;
    let bids = "";
    for (let rep = 0; rep < reps; rep++) {
      bids = "";
      for (let L = 0; L < 26; L++) bids += b.bid({ rack, balance: 60, bagLeft: 40, firstPrice: false, unseen }, L) + " ";
    }
    const per = (performance.now() - t0) / (reps * 26);
    const potPer = b.potCalls ? b.potMs / b.potCalls : 0;
    console.log(`${name} (${s.length} tiles) ${JSON.stringify(cfg)}: ${per.toFixed(1)} ms/bid (potPair ${potPer.toFixed(1)} ms, longIdx=${b.longIdx.length}) bids=${bids}`);
  }
}
