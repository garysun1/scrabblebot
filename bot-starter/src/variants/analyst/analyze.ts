// Analyst: reverse-engineer the leaders' decision rules from the public archive.
// Run: node_modules/.bin/tsx src/variants/analyst/analyze.ts
// Reads scratchpad JSONL (auction results, word plays, archived winning bids, participants),
// reconstructs each bot's visible rack over each match and prints the stats used in REPORT.md.
import fs from "node:fs";
import { Dict, bestPartition, FACE, VOWEL, LETTERS, emptyRack, rackSize, type Rack } from "../../engine.js";

const SP = "/tmp/claude-0/-home-user-scrabblebot/f70bb7c9-93b8-55b6-a54d-fb4c42344a5b/scratchpad/";
const L = (f: string): any[] =>
  fs.readFileSync(SP + f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const LEADERS = new Set([201, 193, 207, 171]);
const names = new Map<number, string>();
for (const r of L("bots2.jsonl")) names.set(r[0], r[1]);

type Auc = { ts: number; id: number; letter: number; winner: number | null; paid: number; bid: number | null };
type Play = { ts: number; bot: number; word: string; pts: number };
type Match = { auc: Map<number, Auc>; plays: Map<string, Play>; seats: Map<number, { score: number; coins: number }> };
const matches = new Map<number, Match>();
const tb = new Map<number, number>();
for (const f of ["x_tb.jsonl", "w_tb.jsonl"]) for (const [a, b] of L(f)) tb.set(a, b);
function getM(m: number): Match {
  let x = matches.get(m);
  if (!x) matches.set(m, (x = { auc: new Map(), plays: new Map(), seats: new Map() }));
  return x;
}
for (const pre of ["x", "y", "z"]) {
  for (const [id, m, letter, w, paid, t] of L(pre + "_ar.jsonl"))
    getM(m).auc.set(id, { ts: t[0], id, letter: letter.charCodeAt(0) - 65, winner: w[0] === 0 ? w[1] : null, paid, bid: tb.get(id) ?? null });
  for (const [m, bot, word, pts, t] of L(pre + "_wp.jsonl")) getM(m).plays.set(`${t[0]}|${bot}|${word}`, { ts: t[0], bot, word, pts });
  for (const [m, bot, score, coins] of L(pre + "_mp.jsonl")) getM(m).seats.set(bot, { score, coins });
}

const d = Dict.load();
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-");
const pct = (a: number[]) => (a.length ? ((100 * a.reduce((x, y) => x + y, 0)) / a.length).toFixed(0) + "%" : "-");

// ---- market median winning bid per letter x phase (5 phases), from all auctions with a known top bid
const mkt: number[][][] = Array.from({ length: 26 }, () => Array.from({ length: 5 }, () => []));
const sortedAuc = new Map<number, Auc[]>();
for (const [m, M] of matches) {
  const auc = [...M.auc.values()].sort((a, b) => a.ts - b.ts);
  sortedAuc.set(m, auc);
  const N = auc.length;
  auc.forEach((a, i) => {
    if (a.winner !== null && a.bid !== null) mkt[a.letter][Math.floor((i * 5) / N)].push(a.bid);
  });
}
const mktMed = mkt.map((r) => r.map(median));
const PREMIUM = new Set([10, 9, 23, 16, 25]); // K J X Q Z
const third = (i: number, N: number) => (i < N / 3 ? 0 : i < (2 * N) / 3 ? 1 : 2);
const TH = ["early", "mid", "late"];

// ---- per-seat reconstruction
type Row = {
  grp: string; bot: number; m: number; i: number; N: number; letter: number; won: boolean; bid: number | null; paid: number;
  med: number; size: number; unk: number; vow: number; face: number; bal: number; has7: boolean;
  near0: number; near1: number; near2: number; nearOk: boolean; bestRackVal: number;
};
type PlayRow = {
  grp: string; bot: number; m: number; left: number; size: number; bal: number; words: string[]; pts: number; bestPart: number;
  bestSingle: number; bestSingleLen: number; maxLenPlayed: number; leftover: number; usedJustWon: boolean; nWordsAvail7: number;
  cont7: boolean; playedAllBest: boolean;
};
const rows: Row[] = [];
const prows: PlayRow[] = [];
const seatStats = new Map<string, { place: number[]; coins: number[]; won: number[]; score: number[]; endRack: number[]; endFace: number[]; lastPlayLeft: number[]; wasteLast: number[]; freeWins: number[]; plays: number[] }>();
function ss(g: string) {
  let x = seatStats.get(g);
  if (!x) seatStats.set(g, (x = { place: [], coins: [], won: [], score: [], endRack: [], endFace: [], lastPlayLeft: [], wasteLast: [], freeWins: [], plays: [] }));
  return x;
}
let fieldSeats = 0;
const FIELD_CAP = 400;
for (const [m, M] of matches) {
  const auc = sortedAuc.get(m)!;
  const N = auc.length;
  if (N < 60 || M.seats.size !== 6) continue;
  const seatsArr = [...M.seats.entries()];
  for (const [bot, fin] of seatsArr) {
    const isL = LEADERS.has(bot);
    if (!isL) {
      if (fieldSeats >= FIELD_CAP) continue;
      fieldSeats++;
    }
    const grp = isL ? "LEADER" : "FIELD";
    const plays = [...M.plays.values()].filter((p) => p.bot === bot).sort((a, b) => a.ts - b.ts);
    // pass 1: minimal hidden tiles consistent with plays
    const hidden = emptyRack();
    {
      const bal = emptyRack(); // won - played so far (can go negative -> hidden)
      let pi = 0;
      for (let i = 0; i <= N; i++) {
        const tsLimit = i < N ? auc[i].ts : Infinity;
        while (pi < plays.length && plays[pi].ts < tsLimit) {
          for (const ch of plays[pi].word) {
            const l = ch.charCodeAt(0) - 65;
            bal[l]--;
            if (-bal[l] > hidden[l]) hidden[l] = -bal[l];
          }
          pi++;
        }
        if (i < N && auc[i].winner === bot) bal[auc[i].letter]++;
      }
    }
    const unk = Math.max(0, 5 - rackSize(hidden));
    // pass 2: walk the match
    const rack = Int8Array.from(hidden);
    let balance = 100;
    let pi = 0;
    let wonCount = 0, freeWins = 0, lastPlayLeft = -1, wasteLast = 0;
    const st = ss(grp);
    let lastWonLetter = -1, lastWonIdx = -2;
    for (let i = 0; i <= N; i++) {
      const tsLimit = i < N ? auc[i].ts : Infinity;
      // plays before auction i closes (group plays within 1500us... use same-call grouping by <1.5s)
      while (pi < plays.length && plays[pi].ts < tsLimit) {
        const call: Play[] = [plays[pi]];
        let pj = pi + 1;
        while (pj < plays.length && plays[pj].ts < tsLimit && plays[pj].ts - plays[pi].ts < 1_500_000) call.push(plays[pj++]);
        const left = N - i; // auctions still to close (incl. current open one)
        const before = Int8Array.from(rack);
        const size = rackSize(before);
        const cands = d.candidates(before, 2);
        const bp = bestPartition(d, before, cands, () => 0, 3000);
        let bestSingle = 0, bestSingleLen = 0, nAvail7 = 0;
        for (const k of cands) {
          if (d.rew[k] > bestSingle) { bestSingle = d.rew[k]; bestSingleLen = d.len[k]; }
          if (d.len[k] >= 7) nAvail7++;
        }
        let pts = 0, maxLen = 0, usedJustWon = false, cont7 = false;
        for (const p of call) {
          pts += p.pts;
          maxLen = Math.max(maxLen, p.word.length);
          if (lastWonIdx === i - 1 && p.word.includes(LETTERS[lastWonLetter])) usedJustWon = true;
          if (p.word.length >= 7) cont7 = true;
          for (const ch of p.word) rack[ch.charCodeAt(0) - 65]--;
          balance += p.pts;
        }
        prows.push({
          grp, bot, m, left, size, bal: balance - pts, words: call.map((p) => p.word), pts, bestPart: bp.wordScore, bestSingle, bestSingleLen,
          maxLenPlayed: maxLen, leftover: rackSize(rack), usedJustWon, nWordsAvail7: nAvail7, cont7, playedAllBest: pts >= bp.wordScore,
        });
        lastPlayLeft = left;
        pi = pj;
      }
      if (i === N) break;
      const a = auc[i];
      const size = rackSize(rack);
      let vow = 0, face = 0;
      for (let l = 0; l < 26; l++) { if (VOWEL[l]) vow += rack[l]; face += rack[l] * FACE[l]; }
      const won = a.winner === bot;
      const doNear = PREMIUM.has(a.letter) || FACE[a.letter] >= 4 || i % 3 === 0;
      let near0 = 0, near1 = 0, near2 = 0, nearOk = false, has7 = false;
      if (doNear) {
        const withL = Int8Array.from(rack); withL[a.letter]++;
        const nw = d.nearWords(withL, a.letter, 2, 7);
        for (const ms of nw.miss) { if (ms === 0) near0++; if (ms <= 1) near1++; near2++; }
        nearOk = true;
        has7 = d.candidates(rack, 7).length > 0;
      }
      rows.push({
        grp, bot, m, i, N, letter: a.letter, won, bid: won ? a.bid : null, paid: a.paid, med: mktMed[a.letter][Math.floor((i * 5) / N)],
        size, unk, vow: size ? vow / size : 0, face, bal: balance, has7, near0, near1, near2, nearOk, bestRackVal: 0,
      });
      if (won) {
        rack[a.letter]++; balance -= a.paid; wonCount++;
        if (a.paid <= 1) freeWins++;
        lastWonLetter = a.letter; lastWonIdx = i;
        if (N - 1 - i <= 2) wasteLast++; // tiles won in the last 3 auctions (rarely playable)
      }
    }
    st.won.push(wonCount); st.freeWins.push(freeWins); st.coins.push(fin.coins); st.score.push(fin.score);
    st.place.push(1 + seatsArr.filter(([, f]) => f.score > fin.score).length);
    st.endRack.push(rackSize(rack)); let ef = 0; for (let l = 0; l < 26; l++) ef += rack[l] * FACE[l]; st.endFace.push(ef);
    st.lastPlayLeft.push(lastPlayLeft); st.wasteLast.push(wasteLast); st.plays.push(plays.length);
  }
}

// ======================= OUTPUT =======================
console.log(`matches=${matches.size} rows=${rows.length} plays=${prows.length}`);
for (const [g, s] of seatStats) {
  console.log(`\n== ${g}: seats=${s.place.length} avgPlace=${f2(mean(s.place))} score=${f1(mean(s.score))} lettersWon=${f1(mean(s.won))} freeWins(paid<=1)=${f2(mean(s.freeWins))} coinsLeft=${f1(mean(s.coins))} (median ${median(s.coins)}) endRackVisible=${f1(mean(s.endRack))} endFace=${f1(mean(s.endFace))} lastPlayAuctionsLeft=${f1(mean(s.lastPlayLeft))} wonInLast3=${f2(mean(s.wasteLast))} plays/match=${f1(mean(s.plays))}`);
}
// per-leader summary
for (const b of LEADERS) {
  const pl = rows.filter((r) => r.bot === b);
  const seats = new Set(pl.map((r) => r.m)).size;
  const won = pl.filter((r) => r.won);
  console.log(`  ${names.get(b)} (${b}): seats=${seats} lettersWon/match=${f1(won.length / seats)} medianPaid=${median(won.map((r) => r.paid))} median bid/med=${f2(median(won.map((r) => r.bid! / r.med)))}`);
}

// ---- Q1: win rates by letter group x third, and rack features at premium wins vs let-go
console.log("\n== Q1 win rate by letter group x phase (leaders vs field)");
const lg = (l: number) => (PREMIUM.has(l) ? "5+pt" : VOWEL[l] ? "vowel" : FACE[l] === 1 ? "1pt-cons" : "2-4pt");
for (const g of ["LEADER", "FIELD"]) {
  for (const k of ["5+pt", "2-4pt", "1pt-cons", "vowel"]) {
    const line = [0, 1, 2].map((t) => {
      const rr = rows.filter((r) => r.grp === g && lg(r.letter) === k && third(r.i, r.N) === t);
      return `${TH[t]} ${pct(rr.map((r) => (r.won ? 1 : 0)))} (n=${rr.length})`;
    });
    console.log(`  ${g} ${k.padEnd(9)} ${line.join(" | ")}`);
  }
}
console.log("\n== Q1 rack at 5+pt auctions: won vs let go (leaders), with near-7 stats (rack+letter)");
for (const g of ["LEADER", "FIELD"]) {
  for (const t of [0, 1, 2]) {
    for (const w of [true, false]) {
      const rr = rows.filter((r) => r.grp === g && PREMIUM.has(r.letter) && third(r.i, r.N) === t && r.won === w && r.nearOk);
      if (!rr.length) continue;
      console.log(
        `  ${g} ${TH[t].padEnd(5)} ${w ? "WON   " : "let go"} n=${String(rr.length).padStart(4)} size=${f1(mean(rr.map((r) => r.size)))}(+${f1(mean(rr.map((r) => r.unk)))} unk) vowel=${f2(mean(rr.map((r) => r.vow)))} bal=${f1(mean(rr.map((r) => r.bal)))} ` +
          `7now=${pct(rr.map((r) => (r.near0 > 0 ? 1 : 0)))} 7in1=${pct(rr.map((r) => (r.near1 > 0 ? 1 : 0)))} 7in2=${pct(rr.map((r) => (r.near2 > 0 ? 1 : 0)))} n7in2=${f1(mean(rr.map((r) => r.near2)))} has7already=${pct(rr.map((r) => (r.has7 ? 1 : 0)))}` +
          (w ? ` bid/med=${f2(median(rr.map((r) => r.bid! / r.med)))} paid/med=${f2(median(rr.map((r) => r.paid / r.med)))}` : ` winnerBid/med=${f2(median(rr.map((r) => (tbBid(r) ?? NaN) / r.med)))}`),
      );
    }
  }
}
function tbBid(r: Row): number | null {
  const a = sortedAuc.get(r.m)![r.i];
  return a.bid;
}
console.log("\n== Q1b leaders' premium WINS split by bid/median (high >=1.3 vs normal): rack features");
for (const g of ["LEADER", "FIELD"]) {
  for (const hi of [true, false]) {
    const rr = rows.filter((r) => r.grp === g && PREMIUM.has(r.letter) && r.won && r.nearOk && (r.bid! / r.med >= 1.3) === hi);
    console.log(`  ${g} ${hi ? "HIGH  " : "normal"} n=${rr.length} size=${f1(mean(rr.map((r) => r.size)))} vowel=${f2(mean(rr.map((r) => r.vow)))} 7now=${pct(rr.map((r) => (r.near0 > 0 ? 1 : 0)))} 7in1=${pct(rr.map((r) => (r.near1 > 0 ? 1 : 0)))} 7in2=${pct(rr.map((r) => (r.near2 > 0 ? 1 : 0)))} n7in2=${f1(mean(rr.map((r) => r.near2)))} bal=${f1(mean(rr.map((r) => r.bal)))} bagLeft=${f1(mean(rr.map((r) => r.N - 1 - r.i)))}`);
  }
}
console.log("\n== Q1c leaders: P(win premium) as a function of near-7 availability (early+mid)");
for (const g of ["LEADER", "FIELD"]) {
  for (const [lab, fn] of [["7now", (r: Row) => r.near0 > 0], ["7in1 only", (r: Row) => r.near0 === 0 && r.near1 > 0], ["7in2 only", (r: Row) => r.near1 === 0 && r.near2 > 0], ["none", (r: Row) => r.near2 === 0]] as const) {
    const rr = rows.filter((r) => r.grp === g && PREMIUM.has(r.letter) && r.nearOk && third(r.i, r.N) < 2 && fn(r));
    console.log(`  ${g} ${lab.padEnd(10)} n=${rr.length} win=${pct(rr.map((r) => (r.won ? 1 : 0)))} medBid/med(won)=${f2(median(rr.filter((r) => r.won).map((r) => r.bid! / r.med)))}`);
  }
}
console.log("\n== Q1d same for ALL letters (sampled auctions with nearOk), leaders: win% by near-7 and by rack size");
for (const g of ["LEADER", "FIELD"]) {
  for (const [lab, fn] of [["7now", (r: Row) => r.near0 > 0], ["7in1 only", (r: Row) => r.near0 === 0 && r.near1 > 0], ["7in2 only", (r: Row) => r.near1 === 0 && r.near2 > 0], ["none", (r: Row) => r.near2 === 0]] as const) {
    const rr = rows.filter((r) => r.grp === g && r.nearOk && fn(r));
    console.log(`  ${g} ${lab.padEnd(10)} n=${rr.length} win=${pct(rr.map((r) => (r.won ? 1 : 0)))} medBid/med(won)=${f2(median(rr.filter((r) => r.won).map((r) => r.bid! / r.med)))}`);
  }
  for (const [lo, hi] of [[0, 5], [6, 9], [10, 14], [15, 99]]) {
    const rr = rows.filter((r) => r.grp === g && r.size >= lo && r.size <= hi);
    console.log(`  ${g} size ${lo}-${hi} n=${rr.length} win=${pct(rr.map((r) => (r.won ? 1 : 0)))} medBid/med(won)=${f2(median(rr.filter((r) => r.won).map((r) => r.bid! / r.med)))} medPaid=${median(rr.filter((r) => r.won).map((r) => r.paid))}`);
  }
}

// ---- Q2: plays
console.log("\n== Q2 word plays (per play call)");
for (const g of ["LEADER", "FIELD"]) {
  const pp = prows.filter((p) => p.grp === g);
  const l7 = pp.filter((p) => p.cont7);
  console.log(`  ${g} calls=${pp.length} (7+: ${l7.length}) auctionsLeft at 7+ play: mean=${f1(mean(l7.map((p) => p.left)))} median=${median(l7.map((p) => p.left))} | rackSize before=${f1(mean(l7.map((p) => p.size)))} leftover after=${f1(mean(l7.map((p) => p.leftover)))} | bal before=${f1(mean(l7.map((p) => p.bal)))}`);
  console.log(`    7+ plays: usedJustWonLetter=${pct(l7.map((p) => (p.usedJustWon ? 1 : 0)))} playedAllOfBestPartition=${pct(l7.map((p) => (p.playedAllBest ? 1 : 0)))} pts/bestPart=${f2(mean(l7.map((p) => p.pts / Math.max(1, p.bestPart))))} betterSingleAvail=${pct(l7.map((p) => (p.bestSingle > p.pts ? 1 : 0)))} words/call=${f2(mean(l7.map((p) => p.words.length)))}`);
  const dist = [[41, 99], [26, 40], [16, 25], [8, 15], [3, 7], [0, 2]].map(([a, b]) => {
    const q = pp.filter((p) => p.left >= a && p.left <= b);
    return `${a}-${b}:${q.length} calls/${q.reduce((s, p) => s + p.pts, 0)}pts`;
  });
  console.log(`    plays by auctionsLeft: ${dist.join("  ")}`);
  const short = pp.filter((p) => !p.cont7);
  console.log(`    short-word calls=${short.length} auctionsLeft mean=${f1(mean(short.map((p) => p.left)))} median=${median(short.map((p) => p.left))} bal before=${f1(mean(short.map((p) => p.bal)))} pts=${f1(mean(short.map((p) => p.pts)))} with 7 available=${pct(short.map((p) => (p.nWordsAvail7 > 0 ? 1 : 0)))} left<=2:${short.filter((p) => p.left <= 2).length}`);
  // holding: auctions where a 7+ is playable (has7) and not played
  const h = rows.filter((r) => r.grp === g && r.nearOk);
  console.log(`    share of sampled auctions with a playable 7+ sitting in the rack: ${pct(h.map((r) => (r.has7 ? 1 : 0)))}; by third: ${[0, 1, 2].map((t) => pct(h.filter((r) => third(r.i, r.N) === t).map((r) => (r.has7 ? 1 : 0)))).join("/")}`);
  // low-balance trigger
  for (const [lo, hi] of [[0, 9], [10, 19], [20, 39], [40, 999]]) {
    const q = l7.filter((p) => p.bal >= lo && p.bal <= hi);
    console.log(`    7+ plays with balance ${lo}-${hi}: ${q.length}  (auctionsLeft mean ${f1(mean(q.map((p) => p.left)))})`);
  }
}
// hold duration: for each leader 7+ play, how many consecutive sampled auctions before it had has7
console.log("\n== Q2b how long a playable 7+ sits before being played (consecutive auctions with has7 before the play, sampled auctions only -> lower bound x~1.5)");
for (const g of ["LEADER", "FIELD"]) {
  const byseat = new Map<string, Row[]>();
  for (const r of rows) if (r.grp === g) { const k = `${r.m}|${r.bot}`; (byseat.get(k) ?? byseat.set(k, []).get(k)!).push(r); }
  const durs: number[] = [];
  for (const p of prows.filter((p) => p.grp === g && p.cont7)) {
    const rr = byseat.get(`${p.m}|${p.bot}`) ?? [];
    let n = 0;
    for (let i = rr.length - 1; i >= 0; i--) { const r = rr[i]; if (r.N - r.i < p.left) continue; if (!r.nearOk) continue; if (r.has7) n++; else break; }
    durs.push(n);
  }
  console.log(`  ${g} mean=${f2(mean(durs))} median=${median(durs)} P(>=2 sampled auctions)=${pct(durs.map((x) => (x >= 2 ? 1 : 0)))}`);
}

// ---- Q3: bid scaling
console.log("\n== Q3 bids (won auctions, bid = archived top bid) by phase (5) : median bid, bid/balance, bid/marketMedian");
for (const g of ["LEADER", "FIELD"]) {
  for (let ph = 0; ph < 5; ph++) {
    const rr = rows.filter((r) => r.grp === g && r.won && r.bid !== null && Math.floor((r.i * 5) / r.N) === ph);
    console.log(`  ${g} phase${ph} n=${rr.length} medBid=${median(rr.map((r) => r.bid!))} meanBid=${f1(mean(rr.map((r) => r.bid!)))} bid/bal=${f2(median(rr.map((r) => r.bid! / Math.max(1, r.bal))))} bid/med=${f2(median(rr.map((r) => r.bid! / r.med)))} medBal=${median(rr.map((r) => r.bal))} overpay(bid-paid)=${f1(mean(rr.map((r) => r.bid! - r.paid)))}`);
  }
}
console.log("\n== Q3b leaders bid/med by balance bucket and by rack size (all won auctions)");
for (const g of ["LEADER", "FIELD"]) {
  for (const [lo, hi] of [[0, 15], [16, 30], [31, 50], [51, 75], [76, 200]]) {
    const rr = rows.filter((r) => r.grp === g && r.won && r.bid !== null && r.bal >= lo && r.bal <= hi);
    console.log(`  ${g} bal ${lo}-${hi} n=${rr.length} medBid=${median(rr.map((r) => r.bid!))} bid/med=${f2(median(rr.map((r) => r.bid! / r.med)))} bid/bal=${f2(median(rr.map((r) => r.bid! / Math.max(1, r.bal))))}`);
  }
  for (const [lo, hi] of [[0, 5], [6, 9], [10, 14], [15, 99]]) {
    const rr = rows.filter((r) => r.grp === g && r.won && r.bid !== null && r.size >= lo && r.size <= hi);
    console.log(`  ${g} size ${lo}-${hi} n=${rr.length} medBid=${median(rr.map((r) => r.bid!))} bid/med=${f2(median(rr.map((r) => r.bid! / r.med)))} wins/auction=${pct(rows.filter((r) => r.grp === g && r.size >= lo && r.size <= hi).map((r) => (r.won ? 1 : 0)))}`);
  }
}
console.log("\n== Q3c leaders: bid/med by letter group x third (won)");
for (const g of ["LEADER", "FIELD"]) {
  for (const k of ["5+pt", "2-4pt", "1pt-cons", "vowel"]) {
    console.log(`  ${g} ${k.padEnd(9)} ${[0, 1, 2].map((t) => { const rr = rows.filter((r) => r.grp === g && lg(r.letter) === k && third(r.i, r.N) === t && r.won && r.bid !== null); return `${TH[t]} ${f2(median(rr.map((r) => r.bid! / r.med)))} (bid ${median(rr.map((r) => r.bid!))}, n=${rr.length})`; }).join(" | ")}`);
  }
}
// bid distribution shape: fraction of won auctions where bid is a round number / exact values
console.log("\n== Q3d most common leader bids per third");
for (const b of LEADERS) {
  for (const t of [0, 1, 2]) {
    const c = new Map<number, number>();
    for (const r of rows) if (r.bot === b && r.won && r.bid !== null && third(r.i, r.N) === t) c.set(r.bid, (c.get(r.bid) ?? 0) + 1);
    const top = [...c.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 8).map(([v, n]) => `${v}x${n}`).join(" ");
    console.log(`  ${names.get(b)} ${TH[t]}: ${top}`);
  }
}
// Q4: late-game: wins in last 5 auctions, balance trajectory
console.log("\n== Q4 balance trajectory (mean balance before auction) by auctions left, and wins in the last 5 auctions");
for (const g of ["LEADER", "FIELD"]) {
  const traj = [60, 50, 40, 30, 20, 15, 10, 5, 2].map((k) => `${k}:${f1(mean(rows.filter((r) => r.grp === g && r.N - r.i === k).map((r) => r.bal)))}`);
  console.log(`  ${g} balance by auctionsLeft ${traj.join(" ")}`);
  const last = rows.filter((r) => r.grp === g && r.N - 1 - r.i <= 5);
  console.log(`  ${g} last-6-auction win rate=${pct(last.map((r) => (r.won ? 1 : 0)))} medBid=${median(last.filter((r) => r.won && r.bid !== null).map((r) => r.bid!))} ; rackSize by auctionsLeft ${[60, 40, 20, 10, 5, 1].map((k) => `${k}:${f1(mean(rows.filter((r) => r.grp === g && r.N - r.i === k).map((r) => r.size + r.unk)))}`).join(" ")}`);
}
