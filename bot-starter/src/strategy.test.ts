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

test("holds a 7-letter word mid-game, cashes it when starved, flushes it at the end", () => {
  const rich = brain.words({ rack: rack("RETAINSQ"), balance: 50, bagLeft: 40, firstPrice: false });
  assert.equal(rich.length, 0);
  const broke = brain.words({ rack: rack("RETAINSQ"), balance: 5, bagLeft: 40, firstPrice: false });
  assert.ok(broke.some((k) => dict.len[k] >= 7), broke.map((k) => dict.word[k]).join(","));
  const end = brain.words({ rack: rack("RETAINSQ"), balance: 50, bagLeft: 1, firstPrice: false });
  assert.ok(end.some((k) => dict.len[k] >= 7));
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

// ---- brain v2 ----
import { BAG_COUNTS } from "./engine.js";
import { Brain2, type State } from "./brain2.js";

const b2 = new Brain2(dict);
const st = (letters: string, balance: number, bagLeft: number): State => ({
  rack: rack(letters),
  balance,
  bagLeft,
  totalAuctions: 68,
  unseen: Int8Array.from(BAG_COUNTS),
  firstPrice: false,
  heat: 1,
});

test("v2: anchor, refined bid and lambda refresh fit inside an auction", () => {
  const s = st("AEINRSTDOLG", 80, 40);
  let t = performance.now();
  b2.refreshLambda(s);
  const tRefresh = performance.now() - t;
  t = performance.now();
  b2.quickBid(s, L("E"));
  const tQuick = performance.now() - t;
  t = performance.now();
  const bid = b2.bid(s, L("E"));
  const tBid = performance.now() - t;
  assert.ok(tQuick < 5, `anchor took ${tQuick}ms`);
  assert.ok(tBid < 300, `refined bid took ${tBid}ms`);
  assert.ok(tRefresh < 1500, `lambda refresh took ${tRefresh}ms`); // v2 is not the live brain; loose bound to avoid CPU-load flakes
  assert.ok(bid >= 0 && bid <= 80);
});

test("v2: all-in on the last usable auction, nothing on the last", () => {
  const s = st("RETAIN", 37, 1);
  s.maxRivalBalance = 20;
  assert.equal(b2.bid(s, L("S")), 21); // capped at richest rival + 1
  assert.equal(b2.bid(st("RETAIN", 37, 0), L("S")), 0);
});

test("v2: holds a cheap short word mid-match, flushes at the end", () => {
  b2.refreshLambda(st("CAT", 60, 40));
  assert.deepEqual(b2.words(st("CAT", 60, 40)), []);
  assert.ok(b2.words(st("CAT", 60, 1)).length === 1);
});
