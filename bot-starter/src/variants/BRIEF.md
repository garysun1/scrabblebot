# ScrabbleBot moonshot brief (read fully before touching anything)

You are one of ~12 agents, each exploring ONE strategy idea for a bot in a
live tournament that starts at 04:45 UTC. **Hard stop: 03:15 UTC** — check
`date -u` as you go and return your report by then even if unfinished.

## Ground rules

- Work ONLY inside `bot-starter/src/variants/<your-slug>/`. Create your
  policy there (copy `src/variants/example/policy.ts` as a starting point; copy
  and modify `src/strategy.ts` into your folder if you need to change the brain).
  Do NOT edit any file outside your folder, do NOT run git, do NOT touch the
  live bot (`src/index.ts`), do NOT install packages, do NOT run `npm test`.
- Your policy may only use what the `State` object gives it (see below). Never
  read the match record, archived top bids, or future auctions. That would be
  cheating in replay and impossible live.
- Keep per-decision compute under ~150 ms on a 28-tile rack (the live auction
  window is 1 s and the client also does other work). Measure if your idea is
  heavy: `node_modules/.bin/tsx` a tiny script that times `bid()` on a big rack.
- Report honestly. A clear negative result is as valuable as a positive one.
  Do not tune on the test split and then report the tuned number as if it were
  out of sample: tune on `REPLAY_SPLIT=train`, confirm on `test`.

## Paths

- Repo: `/home/user/scrabblebot/bot-starter` (run everything from there).
- tsx: `/home/user/scrabblebot/bot-starter/node_modules/.bin/tsx` (use this
  exact binary; `npx tsx` is flaky here).
- Key files: `src/engine.ts` (dictionary + partition search), `src/strategy.ts`
  (current brain "v1" — the live bot), `src/brain2.ts` (market model, fitted
  per-opponent bid models, `State` type), `src/replay.ts` (the arena),
  `src/market.json` (winning-bid distribution per letter x phase from ~450
  archived matches), `src/bots.json` (per-opponent bid model fits),
  `src/replay_hack.json` (117 archived HackUTD-only matches),
  `src/replay_data.json` (older/stronger archive).
- Archive analyses and raw data from earlier tonight (read-only, JSONL):
  `/tmp/claude-0/-home-user-scrabblebot/f70bb7c9-93b8-55b6-a54d-fb4c42344a5b/scratchpad/`
  (`x_ar.jsonl`/`x_wp.jsonl`/`x_mp.jsonl` = auction results, word plays,
  participants for matches >= 42900; `w_*.jsonl` >= 44900; `*_tb.jsonl` = archived
  winning bids by auction id; `bots2.jsonl` = bot id -> name; `q.sh "SQL"` runs a
  read-only SQL query against the live public tables, e.g.
  `./q.sh "SELECT letter, paid FROM auction_result WHERE match_id = 45437"`).

## The game (facts from the module source)

- 6 bots per match, each starts with 100 coins and 5 hidden tiles drawn from a
  98-tile Scrabble bag (no blanks). Each round one letter is drawn and sold in a
  1-second sealed-bid Vickrey auction (winner pays the runner-up's bid; reserve
  1; ties random). Tiles nobody bids on are DISCARDED. So a match is exactly
  98 - 30 = 68 auctions. `bagLeft` = tiles still in the bag after the current
  letter was drawn = auctions remaining after this one.
- The match ends the instant the last auction closes: a tile won in the last
  auction can never be played; words must be submitted before then.
- Score = sum of letter face values x length multiplier: 1x (<=3 letters),
  1.5x (4), 2x (5), 2.5x (6), 3x (7+), integer division. Rewards are paid both as
  score and as spendable cash. No rack limit. Leftover cash and tiles are worth 0.
- Dictionary: ENABLE (~173k words); anagram classes in `Dict`.
- Ranking is by finishing place. Tournament: Swiss rounds (points by place at
  6-seat tables), top cut, elimination (last place out each round at shrinking
  tables), then a heads-up best-of-3 final (2 players, 88 auctions).

## The current bot (v1, `src/strategy.ts`) — the baseline you must beat

- Rack value V(rack) = best set of disjoint words (`bestPartition`, budget 3000
  nodes) + (1 - beta) x hoard(leftover tiles), where hoard is a heuristic
  (face x alpha scaled by "bingo-friendliness", flat base per tile, duplicate
  and vowel-imbalance penalties, Q-without-U penalty) and beta ramps 0 -> 1
  over the last `horizon`=16 auctions (hoard fades as the end nears).
- Bid = (V(rack+L) - V(rack)) x kappa(2.4) x cash factor (sqrt(balance / (bagLeft x
  spendPerAuction)), clamped) x late ramp (1 -> 1.4), then: market floor (bid at
  least the archive median winning bid for that letter/phase when the marginal
  value >= 2), late fill (last 16 auctions: at least 12 if cash allows), minBid
  1 on everything, all-in on the last usable auction (bagLeft <= 1), cap at
  richest rival's balance + 1, 0 on the final auction.
- Words: hold everything (a 7 can grow into an 8); cash 5+ letter words only when
  balance < 20; flush the exact best partition when bagLeft <= 1.
- `DEFAULT_PARAMS` in `src/strategy.ts` are the live values.

### Tried and rejected tonight (don't repeat as-is; combine or rethink)
- v2 (`src/brain2.ts`): Monte Carlo letter values over sampled unseen tiles +
  a solved coin price lambda + fitted market/opponent models: 2.76-3.22 vs v1's
  2.5-2.7 on the same pool. Spent everything, converted worse; cashed too early.
- Higher bid scale (kappa 3-4), late ramp 1.6, lower cap: worse.
- Cashing high-value short words mid-match (ZAG-style): worse (2.51 vs 2.37).
- Bidding more on 5+ point letters, blind (x1.3/1.6/2.0): monotonically worse.
  Conditional on a 7-letter word with that letter being within 2 tiles of the
  rack (`nearWords`/`nearValue`, weight 0.3/0.6/1.0): 2.14/2.20/2.32 vs 2.12.
- minMidLen 5/6 (play 5-6 letter words mid-match): worse. Early market floor
  multipliers > 1.0: worse.
- Per-opponent price model (compose seated rivals' fitted bid distributions,
  truncate at balances) inside v2: no gain.

### What worked (each verified out of sample)
- Removing the 60%-of-balance bid cap: 2.79 -> 2.51.
- Late fill + lower kappa/pace (optimizer): -> 2.41.
- Market floor at the median winning bid: -> 2.22.
- Holding 7-letter words until starved or the flush: -> 2.07-2.12.
- minBid 1 (free tiles when nobody bids; big in heads-up).

## What the leaders do (archive, tonight, 6-seat tables)

| | Leaders (Lbender, RackMaw, LexForge-1107, GodOfThudner) | us |
|---|---|---|
| avg place | 1.8-2.0 | 2.5-2.8 |
| letters won / match | 14-16 | 12-13 |
| price paid / letter | 13.5 | 12.5 |
| coins left at end | 9-15 | 15-25 |
| win % of 5+pt letters (K J X Q Z) early/mid/late | 46 / 34 / 27 | 19 / 28 / 12 |
| win % vowels early/mid/late | 11 / 21 / 21 | 10 / 17 / 21 |
| share of points from 7+ letter words | 72-82% | ~75% |
| points scored with 15-40 auctions left | ~51% | ~38% |
| points per tile acquired | 5.0-5.3 | 4.5 |
| words per play call (max) | 2 | 2 |
| bids on the last auction | never | never |
They play their 7-letter words mid-match (avg ~20 auctions left) and reinvest;
their sample plays: ZINGARE, OXYACID, ARCHAIZE, INJECTOR, GLAZIER, JEEPING,
VANQUISH — they build 7s around premium letters. RackMaw and LexForge-1107 have
near-identical fingerprints (likely one codebase). None has public code. exzell
(public, MIT, `/tmp/.../scratchpad/ext/exzell`) is a v1-like design with hand-set
per-letter floors and holding 7s; K-13 (last tournament's champion, public, no
license, `/tmp/.../scratchpad/ext/k13-scrabblebot`) uses MC look-ahead, a solved
lambda, per-opponent bid models, denial bidding, and dumps at the last auction.

## The arena (`src/replay.ts`) — how you evaluate

Your policy plays as a ghost 7th seat inside archived real matches against the
real recorded bids (it wins a tile if it outbids the recorded winning bid; pays
that bid; the real winner loses the tile, its score is scaled down for that).
Rivals don't react, so it is an approximation, but it has been directionally
right all night. Place is out of 7.

Command (from `bot-starter/`):
```
REPLAY_FILE=./replay_hack.json REPLAY_SPLIT=test REPLAY_SEEDS=4 \
REPLAY_POLICY=./variants/<slug>/policy.ts \
/home/user/scrabblebot/bot-starter/node_modules/.bin/tsx src/replay.ts x 200 11 '{"yourParam":1}'
```
- `200` = all matches of the split; `11` = seed (also use `23`); the JSON is
  passed to your `makePolicy` as `over`.
- `REPLAY_SPLIT=train` for tuning, `test` for reporting. Final confirmation on
  the strong pool: `REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1 REPLAY_SEEDS=4 ... src/replay.ts x 97 11 '{}'`.
- Baselines for the current bot are in `src/variants/BASELINES.txt`. Noise:
  standard error ~0.08 in avg place at ~230 runs; call something a win only if
  it beats the baseline by >= 0.10 on BOTH test seeds (11 and 23) and does not
  lose on the strong pool.
- Other agents are running replays at the same time; a 230-run eval takes 1-3
  minutes. Budget your runs.

`State` (from `src/brain2.ts`) given to `bid(s)` / `words(s)`: `rack` (Int8Array[26]
counts), `balance`, `bagLeft`, `totalAuctions`, `unseen` (Int8Array[26]: tiles not
yet seen = bag + rivals' hidden tiles), `firstPrice`, `maxRivalBalance`,
`rivals` [{id, balance}], `score` (ours), `rivalScores` {id: score so far},
`auctionIndex`. The letter being auctioned is `pol.letter` (0..25).
`words(s)` returns dictionary class indices to play now (see `Dict.word[k]`,
`Dict.rew[k]`, `Dict.len[k]`, `Dict.candidates(rack)`, `Dict.fits(k, rack)`,
`bestPartition(d, rack, cands, leftoverFn, budget)`).

## Deliverable

Write `src/variants/<slug>/RESULT.md` AND return the same content as your final
message:
1. Idea and mechanism (3-6 lines).
2. Files you created.
3. Every evaluation you ran: the exact command's key settings and the replay
   output line, verbatim (train/test/strong, seed, config).
4. Best configuration and its test-seed-11, test-seed-23 and strong-pool
   numbers next to the baselines.
5. Verdict: WIN / NEUTRAL / LOSS, with the margin.
6. Risks: compute time per decision on big racks, any behaviour that could
   fail live (e.g. depends on data not available live), heads-up concerns.
7. How to enable it (a param, or "replace X in strategy.ts with Y").
