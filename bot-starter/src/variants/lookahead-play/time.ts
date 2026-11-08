// Times the play/hold decision on big racks.
// Run: node_modules/.bin/tsx src/variants/lookahead-play/time.ts
import { Dict, BAG_COUNTS, emptyRack } from "../../engine.js";
import type { State } from "../../brain2.js";
import { makePolicy } from "./policy.js";
import { mulberry } from "../../replay.js";

const d = Dict.load();
const rnd = mulberry(7);
const over = JSON.parse(process.argv[2] ?? "{}");
const pol = makePolicy(d, over, rnd);
let worst = 0;
let worstBid = 0;
let total = 0;
let n = 0;
for (let trial = 0; trial < 40; trial++) {
  // random 28-tile rack drawn from the bag, unseen = rest
  const pool = Int8Array.from(BAG_COUNTS);
  const rack = emptyRack();
  let tot = 98;
  for (let t = 0; t < 28; t++) {
    let idx = Math.floor(rnd() * tot);
    for (let i = 0; i < 26; i++) {
      if (idx < pool[i]) { pool[i]--; rack[i]++; tot--; break; }
      idx -= pool[i];
    }
  }
  const bagLeft = 10 + Math.floor(rnd() * 30);
  const s: State = { rack, balance: 40, bagLeft, totalAuctions: 68, unseen: pool, firstPrice: false, maxRivalBalance: 80, heat: 1 };
  const t0 = performance.now();
  const ws = pol.words(s);
  const dt = performance.now() - t0;
  pol.letter = Math.floor(rnd() * 26);
  const t1 = performance.now();
  pol.bid(s);
  const db = performance.now() - t1;
  worst = Math.max(worst, dt);
  worstBid = Math.max(worstBid, db);
  total += dt;
  n++;
  if (trial < 3) console.log(`rack ${Array.from(rack).map((c, i) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i].repeat(c)).join("")} bagLeft ${bagLeft} -> play ${ws.map((k) => d.word[k]).join(",") || "(hold)"} words ${dt.toFixed(1)}ms bid ${db.toFixed(1)}ms`);
}
console.log(`words(): worst ${worst.toFixed(1)}ms avg ${(total / n).toFixed(1)}ms; bid(): worst ${worstBid.toFixed(1)}ms; MC decisions ${pol.brain.stats.decisions} plays ${pol.brain.stats.plays} MC worst ${pol.brain.stats.msMax.toFixed(1)}ms`);
