// Word engine: alphagram index over the dictionary, fast "which words fit
// this rack" scans, and a bounded best-partition search.
//
// Reward for a word depends only on its letter multiset, so every anagram
// class is stored once (with one representative spelling).

import * as fs from "node:fs";
import * as path from "node:path";

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const FACE = [
  1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10,
];
export const BAG_COUNTS = [
  9, 2, 2, 4, 12, 2, 3, 2, 9, 1, 1, 4, 2, 6, 8, 2, 1, 6, 4, 6, 4, 2, 2, 1, 2, 1,
];
export const VOWEL = LETTERS.split("").map((c) => "AEIOU".includes(c));

export type Rack = Int8Array; // length 26

export function emptyRack(): Rack {
  return new Int8Array(26);
}
export function rackFromMap(m: Map<string, number>): Rack {
  const r = emptyRack();
  for (const [c, n] of m) {
    const i = c.charCodeAt(0) - 65;
    if (i >= 0 && i < 26) r[i] += n;
  }
  return r;
}
export function rackSize(r: Rack): number {
  let s = 0;
  for (let i = 0; i < 26; i++) s += r[i];
  return s;
}
export function rackFace(r: Rack): number {
  let s = 0;
  for (let i = 0; i < 26; i++) s += r[i] * FACE[i];
  return s;
}
export function rackMask(r: Rack): number {
  let m = 0;
  for (let i = 0; i < 26; i++) if (r[i] > 0) m |= 1 << i;
  return m >>> 0;
}
export function rackToString(r: Rack): string {
  let s = "";
  for (let i = 0; i < 26; i++) s += LETTERS[i].repeat(Math.max(0, r[i]));
  return s;
}

/** Reward the module pays for a word of `len` letters with face sum `base`. */
export function reward(base: number, len: number): number {
  if (len <= 3) return base;
  if (len === 4) return Math.floor((base * 3) / 2);
  if (len === 5) return base * 2;
  if (len === 6) return Math.floor((base * 5) / 2);
  return base * 3;
}

export class Dict {
  n = 0;
  counts!: Uint8Array; // n * 26
  mask!: Uint32Array;
  len!: Uint8Array;
  base!: Uint16Array;
  rew!: Uint16Array;
  word!: string[];
  /** indices sorted by reward desc (ties: longer first) */
  order!: Int32Array;

  static load(file?: string): Dict {
    const p =
      file ??
      path.join(
        path.dirname(new URL(import.meta.url).pathname),
        "..",
        "..",
        "spacetimedb",
        "wordlist.txt",
      );
    const words = fs
      .readFileSync(p, "utf8")
      .split("\n")
      .map((l) => l.trim().toUpperCase())
      .filter((l) => l.length >= 2 && /^[A-Z]+$/.test(l));
    return Dict.fromWords(words);
  }

  static fromWords(words: string[]): Dict {
    const seen = new Map<string, string>();
    for (const w of words) {
      const key = w.split("").sort().join("");
      if (!seen.has(key)) seen.set(key, w);
    }
    const d = new Dict();
    const n = seen.size;
    d.n = n;
    d.counts = new Uint8Array(n * 26);
    d.mask = new Uint32Array(n);
    d.len = new Uint8Array(n);
    d.base = new Uint16Array(n);
    d.rew = new Uint16Array(n);
    d.word = new Array(n);
    let k = 0;
    for (const w of seen.values()) {
      let m = 0;
      let b = 0;
      for (let j = 0; j < w.length; j++) {
        const i = w.charCodeAt(j) - 65;
        d.counts[k * 26 + i]++;
        m |= 1 << i;
        b += FACE[i];
      }
      d.mask[k] = m >>> 0;
      d.len[k] = w.length;
      d.base[k] = b;
      d.rew[k] = reward(b, w.length);
      d.word[k] = w;
      k++;
    }
    const idx = Array.from({ length: n }, (_, i) => i);
    idx.sort((a, b) => d.rew[b] - d.rew[a] || d.len[b] - d.len[a]);
    d.order = Int32Array.from(idx);
    return d;
  }

  fits(k: number, r: Rack): boolean {
    const o = k * 26;
    const c = this.counts;
    for (let i = 0; i < 26; i++) if (c[o + i] > r[i]) return false;
    return true;
  }

  /** All anagram classes playable from `r` with length >= minLen, in reward-desc order. */
  candidates(r: Rack, minLen = 2): number[] {
    const total = rackSize(r);
    const rm = rackMask(r);
    const out: number[] = [];
    const ord = this.order;
    for (let j = 0; j < this.n; j++) {
      const k = ord[j];
      const L = this.len[k];
      if (L > total || L < minLen) continue;
      if ((this.mask[k] & ~rm) !== 0) continue;
      if (this.fits(k, r)) out.push(k);
    }
    return out;
  }

  /** Narrow an existing candidate list to those fitting `r`. */
  filter(cands: number[], r: Rack, minLen = 2): number[] {
    const out: number[] = [];
    for (const k of cands) if (this.len[k] >= minLen && this.fits(k, r)) out.push(k);
    return out;
  }
}

export interface Partition {
  words: number[]; // dict indices
  score: number; // sum of rewards (+ leftover value)
  wordScore: number;
}

function sub(r: Rack, d: Dict, k: number) {
  const o = k * 26;
  for (let i = 0; i < 26; i++) r[i] -= d.counts[o + i];
}
function add(r: Rack, d: Dict, k: number) {
  const o = k * 26;
  for (let i = 0; i < 26; i++) r[i] += d.counts[o + i];
}

/**
 * Best set of disjoint words from `rack` maximizing
 *   sum(reward(word)) + leftover(remaining rack).
 * Bounded DFS over the candidate list (reward-desc), so the first leaf is the
 * greedy answer and extra budget only improves it.
 */
export function bestPartition(
  d: Dict,
  rack: Rack,
  cands: number[],
  leftover: (r: Rack) => number = () => 0,
  budget = 4000,
  maxBound = 3,
): Partition {
  const r = Int8Array.from(rack);
  let best: Partition = { words: [], score: leftover(r), wordScore: 0 };
  let nodes = 0;
  const stack: number[] = [];
  const dfs = (start: number, acc: number) => {
    nodes++;
    const lv = leftover(r);
    if (acc + lv > best.score) {
      best = { words: stack.slice(), score: acc + lv, wordScore: acc };
    }
    // Optimistic bound: every remaining tile scores at maxBound x face.
    if (acc + rackFace(r) * maxBound + Math.max(lv, 0) <= best.score) return;
    for (let j = start; j < cands.length; j++) {
      if (nodes > budget) return;
      const k = cands[j];
      if (!d.fits(k, r)) continue;
      sub(r, d, k);
      stack.push(k);
      dfs(j, acc + d.rew[k]);
      stack.pop();
      add(r, d, k);
    }
  };
  dfs(0, 0);
  return best;
}
