// Checks for the strategy. Run with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Dict, rackFromMap } from "./engine.js";
import { Brain } from "./strategy.js";

const dict = Dict.load();
const brain = new Brain(dict);
const rack = (letters: string) => {
  const r = new Map<string, number>();
  for (const c of letters) r.set(c, (r.get(c) ?? 0) + 1);
  return rackFromMap(r);
};
const L = (c: string) => c.charCodeAt(0) - 65;

test("plays a 7-letter word as soon as it has one", () => {
  const words = brain.words({ rack: rack("RETAINSQ"), balance: 50, bagLeft: 40, firstPrice: false });
  assert.ok(words.some((k) => dict.len[k] >= 7), words.map((k) => dict.word[k]).join(","));
});

test("hoards short words mid-game but flushes them at the end", () => {
  const mid = brain.words({ rack: rack("CAT"), balance: 50, bagLeft: 40, firstPrice: false });
  assert.equal(mid.length, 0);
  const end = brain.words({ rack: rack("CAT"), balance: 50, bagLeft: 1, firstPrice: false });
  assert.deepEqual(end.map((k) => dict.word[k]), ["ACT"].map((w) => dict.word[dict.candidates(rack(w)).find((k) => dict.len[k] === 3)!]));
});

test("never bids on the last auction, never beyond balance", () => {
  assert.equal(brain.bid({ rack: rack("RETAIN"), balance: 50, bagLeft: 0, firstPrice: false }, L("S")), 0);
  const b = brain.bid({ rack: rack("RETAIN"), balance: 7, bagLeft: 30, firstPrice: false }, L("S"));
  assert.ok(b >= 0 && b <= 7);
});

test("values a bingo-completing letter highly", () => {
  const v = { balance: 100, bagLeft: 30, firstPrice: false };
  // RETAIN + S = RETAINS (bingo); WWKVV + S makes nothing long.
  assert.ok(brain.bid({ ...v, rack: rack("RETAIN") }, L("S")) > brain.bid({ ...v, rack: rack("WWKVV") }, L("S")));
});

test("decisions are fast enough for a 1s auction", () => {
  const v = { rack: rack("AEIRSTLNODGBCMP"), balance: 100, bagLeft: 30, firstPrice: false };
  const t = performance.now();
  brain.bid(v, L("E"));
  brain.words(v);
  assert.ok(performance.now() - t < 150, `took ${performance.now() - t}ms`);
});
