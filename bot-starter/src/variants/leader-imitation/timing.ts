// Times policy.bid() on big racks (brief: keep < ~150 ms on a 28-tile rack).
// Run: node_modules/.bin/tsx src/variants/leader-imitation/timing.ts
import { Dict, rackFromMap } from "../../engine.js";
import { makePolicy } from "./policy.js";
import { Brain, DEFAULT_PARAMS } from "../../strategy.js";
const d = Dict.load();
const pol = makePolicy(d, { liQ: 1 }, Math.random);
const rk = (s: string) => { const m = new Map<string, number>(); for (const c of s) m.set(c, (m.get(c) ?? 0) + 1); return rackFromMap(m); };
// Equivalence check: with the leader floor off, the policy must reproduce Brain.bid exactly.
{
  const off = makePolicy(d, { liQ: -1 }, Math.random);
  const brain = new Brain(d, DEFAULT_PARAMS);
  let bad = 0, n = 0;
  const racks = ["AEINRSTDOLGUBC", "QZXJKEAIOU"];
  for (const rs of racks) for (const bagLeft of [50, 20, 8, 1]) for (const balance of [100, 30]) for (let L = 0; L < 26; L++) {
    const s = { rack: rk(rs), balance, bagLeft, totalAuctions: 68, unseen: rk("AEIOU"), firstPrice: false, maxRivalBalance: 80, heat: 1, auctionIndex: 67 - bagLeft } as any;
    off.letter = L;
    const a = off.bid(s), b = brain.bid({ rack: s.rack, balance, bagLeft, firstPrice: false, maxRivalBalance: 80, unseen: s.unseen }, L);
    n++; if (a !== b) bad++;
  }
  console.log(`v1 equivalence (liQ:-1 vs Brain.bid): ${n - bad}/${n} identical`);
}
for (const rs of ["AEINRST", "AEINRSTDOLGUBC", "AEEINORSTTDLGUBCMPAI", "AEEEIINOORSSTTDLLGUBCMPKAIRN"]) {
  const s = { rack: rk(rs), balance: 60, bagLeft: 12, totalAuctions: 68, unseen: rk("AEIOU"), firstPrice: false, heat: 1, auctionIndex: 55 } as any;
  pol.letter = 4;
  // CPU time (user+system) is reported too: wall-clock is inflated on a loaded box.
  let c = process.cpuUsage(); let t = performance.now(); pol.bid(s); const tb = performance.now() - t; const cb = process.cpuUsage(c);
  c = process.cpuUsage(); t = performance.now(); pol.words(s); const tw = performance.now() - t; const cw = process.cpuUsage(c);
  console.log(`${rs.length} tiles: bid ${tb.toFixed(0)}ms wall / ${((cb.user + cb.system) / 1000).toFixed(0)}ms cpu; words ${tw.toFixed(0)}ms wall / ${((cw.user + cw.system) / 1000).toFixed(0)}ms cpu`);
}
