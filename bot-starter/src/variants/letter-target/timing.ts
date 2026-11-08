// Times bid() of the letter-target brain on a 28-tile rack (brief: keep < ~150 ms).
// Run from bot-starter/:  node_modules/.bin/tsx src/variants/letter-target/timing.ts
import { Dict, emptyRack } from "../../engine.js";
import { Brain, DEFAULT_PARAMS } from "./strategy.js";

const d = Dict.load();
const brain = new Brain(d, { ...DEFAULT_PARAMS, tgtLetters: 15, heatW: 0.15 });
// A plausible 28-tile mid-match rack (letters by bag frequency).
const rack = emptyRack();
for (const ch of "AAAEEEIIOOUNNRRSSTTLLDGBCMPHY") rack[ch.charCodeAt(0) - 65]++;
let n = 0;
for (let i = 0; i < 26; i++) n += rack[i];
const view = { rack, balance: 60, bagLeft: 30, firstPrice: false, maxRivalBalance: 90, won: 9, auctionIndex: 37, totalAuctions: 68, heat: 1.3 };
let worst = 0;
let total = 0;
for (let rep = 0; rep < 2; rep++) {
  for (let L = 0; L < 26; L++) {
    const t0 = performance.now();
    brain.bid(view, L);
    const dt = performance.now() - t0;
    if (rep === 1) {
      total += dt;
      if (dt > worst) worst = dt;
    }
  }
}
const t1 = performance.now();
brain.words(view);
console.log(`rack ${n} tiles: bid() avg ${(total / 26).toFixed(1)} ms, worst ${worst.toFixed(1)} ms; words() ${(performance.now() - t1).toFixed(1)} ms`);
