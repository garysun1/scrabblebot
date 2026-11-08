# stem-potential — RESULT

## 1. Idea and mechanism

Replace / blend the hand-written `hoard()` heuristic with a dictionary-derived
"stem potential". For a rack R, `potential(R)` aggregates, over all 7-8 letter
anagram classes within <= 2 missing tiles of R (and not already playable),
`reward(class) x prod_{missing tile l} q(l)` with
`q(l) = pWin x (1 - (1 - bagLeft/U)^unseen[l])` (U = total unseen tiles, so q is
the chance another `l` is still in the bag and gets auctioned, times a flat
per-tile win chance pWin = 0.3). Aggregates tried: per-word `best + potAgg x (sum - best)`
(Gaucho-style max at potAgg 0, plain sum at 1), reward-scale saturation
`S(1 - exp(-raw/S))`, and a bucketed form (max reward per missing-letter / missing-pair
bucket x P(bucket), singles-only as a sub-variant). The old hoard is scaled by
`hoardW` (1 = v1, 0 = removed) and the bid gain becomes
`[partition(R+L) - partition(R)] + potW x (1-beta) x [potential(R+L) - potential(R)]`,
both potentials from ONE scan of the 44,858 7-8 letter classes (mask prefilter on
letters the rack lacks entirely, then a 26-letter deficit loop).

## 2. Files created (all under `src/variants/stem-potential/`)

- `strategy.ts` — copy of `src/strategy.ts` with `hoardW`, `potPair()`, `aggregate()` and the new params (`potW, hoardW, pWin, potAgg, potSat, potMinLen, potMaxLen, potMaxMiss, potFade, potMinBag, potBucket`). With `potW: 0, hoardW: 1` it reproduces v1 exactly (verified below).
- `policy.ts` — `makePolicy` wrapper; `TUNED` holds a configuration, the command-line JSON overrides it.
- `time_bid.ts` — compute probe on 20/25/28-tile racks.
- `RESULT.md` — this file.

## 3. Evaluations run

All with `REPLAY_FILE=./replay_hack.json REPLAY_SEEDS=4 REPLAY_POLICY=./variants/stem-potential/policy.ts
.../tsx src/replay.ts x 200 <seed> '<json>'` unless marked strong
(`REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1 REPLAY_SEEDS=4 ... x 97 11`).
Machine was at load average 70-115 on 4 cores (other agents' replays), hence the ms/match figures.
Baseline (BASELINES.txt): test s11 2.09 / test s23 2.08 / strong 2.07.

Harness sanity, test s11, `{"potW":0,"hoardW":1}` (must equal v1) ->
`n=232: avg place 2.09 score 89.9 win 0.40 letters 12.8 endbal 21 places[1..7]=93,77,28,22,6,6,0 (3264ms/match)` — identical to the baseline line.

Per-word aggregate, unsaturated (potAgg 0.15, pWin 0.3), train s11:
- `{"potW":0.3,"hoardW":1}` (light blend over the full hoard) -> `n=236: avg place 4.32 score 60.9 win 0.03 letters 9.9 endbal 16 places[1..7]=6,23,41,58,49,45,14 (4184ms/match)`
- `{"potW":0.6,"hoardW":0.6}` -> `n=236: avg place 4.53 score 57.4 win 0.01 letters 9.4 endbal 16 places[1..7]=3,17,39,53,60,46,18 (2445ms/match)`
- `{"potW":1,"hoardW":0.3}` -> `n=236: avg place 4.79 score 54.1 win 0.00 letters 8.4 endbal 19 places[1..7]=0,13,32,54,57,53,27 (2408ms/match)`
- `{"potW":1,"hoardW":0}` (hoard replaced) -> `n=236: avg place 4.85 score 53.8 win 0.00 letters 8.0 endbal 24 places[1..7]=1,8,31,53,63,53,27 (2265ms/match)`
- test s11 `{"potW":0.6,"hoardW":0.6}` -> `n=232: avg place 4.36 score 59.9 win 0.05 letters 9.9 endbal 15 places[1..7]=11,22,31,49,60,46,13 (4512ms/match)`

Per-word aggregate, near-max (potAgg 0.03), `{"potW":1,"hoardW":0.6,"potAgg":0.03}`:
- train s11 -> `n=236: avg place 4.28 score 60.6 win 0.02 letters 9.9 endbal 16 places[1..7]=4,22,43,61,57,38,11 (4470ms/match)`
- test s11 -> `n=232: avg place 4.25 score 61.9 win 0.04 letters 10.4 endbal 15 places[1..7]=10,22,37,56,55,43,9 (4529ms/match)`

Bucketed aggregate (max reward per missing-letter / missing-pair bucket x P(bucket)):
- `{"potBucket":1,"potW":1,"hoardW":0.6}` train s11 -> `n=236: avg place 4.74 score 53.5 win 0.01 letters 8.7 endbal 15 places[1..7]=2,12,32,51,64,53,22 (3294ms/match)`
- same, test s11 -> `n=232: avg place 4.71 score 55.1 win 0.03 letters 9.1 endbal 15 places[1..7]=6,10,31,50,54,64,17 (3255ms/match)`
- same, test s23 -> `n=232: avg place 4.70 score 55.1 win 0.01 letters 9.0 endbal 15 places[1..7]=2,16,29,53,54,59,19 (3296ms/match)`
- same, strong pool -> `n=388: avg place 4.55 score 59.6 win 0.02 letters 10.0 endbal 16 places[1..7]=7,21,54,83,127,85,11 (2294ms/match)`
- `{"potBucket":1,"potW":0.3,"hoardW":1}` train s11 -> `n=236: avg place 4.63 score 55.8 win 0.02 letters 8.9 endbal 16 places[1..7]=5,12,35,59,50,53,22 (4162ms/match)`
- same, test s11 -> `n=232: avg place 4.54 score 58.1 win 0.04 letters 9.2 endbal 17 places[1..7]=9,13,34,50,53,60,13 (4224ms/match)`

Bucketed, singles only (deficit 1), reward-scale saturation, mild weight, full hoard kept —
the only variant whose bids on big racks equal v1's (the term saturates there, so it only speaks on weak racks),
`{"potBucket":1,"potMaxMiss":1,"potSat":40,"potW":0.5,"hoardW":1}`:
- train s11 -> `n=236: avg place 2.43 score 85.5 win 0.27 letters 12.6 endbal 19 places[1..7]=63,80,49,26,9,8,1 (2734ms/match)`
- test s11 -> `n=232: avg place 2.49 score 83.6 win 0.28 letters 12.3 endbal 20 places[1..7]=64,72,49,26,9,11,1 (2781ms/match)`

Per-word aggregate with reward-scale saturation, `{"potW":1,"hoardW":0.6,"potSat":40}` (pre-registered before any result was seen):
- train s11 -> `n=236: avg place 3.29 score 73.4 win 0.10 letters 11.2 endbal 19 places[1..7]=23,51,64,51,31,12,4 (5379ms/match)`
- test s11 -> `n=232: avg place 3.47 score 72.4 win 0.10 letters 11.1 endbal 20 places[1..7]=23,43,56,54,26,28,2 (5500ms/match)`
- test s23 -> `n=232: avg place 3.40 score 72.6 win 0.12 letters 10.9 endbal 19 places[1..7]=27,39,61,52,27,24,2 (5514ms/match)`
- strong pool -> `n=388: avg place 3.28 score 80.8 win 0.11 letters 12.5 endbal 18 places[1..7]=44,74,106,83,58,20,3 (3373ms/match)`

Pure max over near words (Gaucho-style, potAgg 0), `{"potW":1,"hoardW":0.6,"potAgg":0}`:
- train s11 -> `n=236: avg place 2.53 score 83.1 win 0.24 letters 12.0 endbal 20 places[1..7]=57,74,52,37,10,4,2 (5362ms/match)`

## 4. Best configuration vs baselines

No configuration beats or matches the baseline. Least bad: singles-only bucketed, saturated
`{"potBucket":1,"potMaxMiss":1,"potSat":40,"potW":0.5,"hoardW":1}`:

| | test s11 | test s23 | strong |
|---|---|---|---|
| baseline v1 | 2.09 | 2.08 | 2.07 |
| least-bad stem-potential (above; train 2.43) | 2.49 | not run (not worth it) | not run |
| pure max (Gaucho-style), potW 1 / hoardW 0.6 (train 2.53) | not run | not run | not run |
| per-word, saturated S=40, potW 1 / hoardW 0.6 (train 3.29) | 3.47 | 3.40 | 3.28 |
| bucketed pairs, potW 1 / hoardW 0.6 (train 4.74) | 4.71 | 4.70 | 4.55 |

## 5. Verdict

**LOSS.** Every form of the stem potential loses: -0.40 places for the mildest version
(test s11 2.49 vs 2.09, train 2.43), -0.44 for the Gaucho-style pure max (train 2.53),
-1.2 to -1.4 for the saturated per-word form (test 3.47 / 3.40, strong 3.28), and -2.2 to
-2.7 places for any version strong enough to change bids on normal racks (train 4.28-4.85;
test 4.25-4.71 on both seeds; strong pool 4.55 vs 2.07). Caveat: most configs also
scaled the v1 hoard to 0.6 and no hoardW-only control was run, so part of the saturated
and pure-max losses may be the hoard reduction rather than the potential term; the
mildest version kept hoardW = 1 and still lost 0.40. Mechanism of the failure (bid probe, rack RETAIN, 40 auctions left,
balance 60): near-words are alternatives, not independent payoffs. A 6-letter stem has
hundreds of 7-8 letter completions, so any additive aggregate values the rack at 150-460
"points" and values one more S/D/E/U/O at +50 to +480 -> all-in bids (60 of 60) on nearly
every letter where v1 bids 9-13. The bot then wins 8-10 letters per match instead of 12.8,
at a higher price, and scores 54-62 instead of 90. Shrinking the weight (0.3 x), near-max
(potAgg 0.03) or max-per-bucket does not change the picture because the *marginal* of a
sum over hundreds of words stays huge. Saturating at a reward scale (S = 40) fixes the
scale but then every decent rack is "certainly a bingo" and Δpotential collapses to ~0.8
for all letters (no information), while on weak racks it still bids all-in on E/O/U (E ->
60 vs v1 20) and loses 0.4 places. Max-per-bucket also breaks monotonicity (on a 25-tile
rack adding S lowered the potential by 38 because newly playable words leave the term while
the budget-limited partition credits only +2.7). v1's flat per-tile hoard (base 3.2 + face
x alpha x friendliness) is, in effect, a well-calibrated saturating potential already;
the dictionary-derived one needs a mutually-exclusive-alternatives model (value of the
best completion we will actually get) rather than any sum, and there was no time left to
build and tune that.

## 6. Risks

- Compute: `potPair` scans 44,858 classes once per bid. Measured on a 4-core box at
  load average 69-115 (85+ concurrent replays from other agents), so absolute numbers
  are inflated ~15-30x: v1 bid() alone took 459-526 ms (25 tiles) / 1370-1385 ms (28
  tiles) under that load; `potPair` added 27-67 ms per bid, i.e. 3-13% on top of v1's
  partition search (per-word mode 36-58 ms; bucketed singles 27-41 ms; bucketed pairs
  40-67 ms). Unloaded that is an estimated 2-5 ms per bid, well inside the 150 ms
  budget; it runs once per `bid()` (never inside the partition DFS, never in `words()`).
- Uses only `State.rack`, `State.unseen`, `State.bagLeft` — all available live; nothing
  from the match record.
- Scale pathology described in the verdict: any deployment of a potential term must
  bound Δpotential per letter to the order of a word reward, or it will go all-in.
- Heads-up (88 auctions, 2 players): `unseen` is mostly the bag, so q is higher and the
  potential term grows further; pWin = 0.3 is a 6-seat value (2-seat ~0.5). Not evaluated.

## 7. How to enable

Do not. If someone wants to experiment: import `Brain`/`DEFAULT_PARAMS` from
`src/variants/stem-potential/strategy.js` in `src/index.ts` and pass a JSON config as the
`over` object (`potW`, `hoardW`, `potBucket`, `potMaxMiss`, `potSat`, `pWin`, `potAgg`).
With `potW: 0, hoardW: 1` it is identical to v1 (verified bit-for-bit on test seed 11).
