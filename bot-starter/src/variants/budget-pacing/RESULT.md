# budget-pacing — RESULT

## 1. Idea and mechanism
Keep v1's letter VALUES (its ranking of letters is good) but replace the bid scaling
(kappa x cash factor x late ramp) with a budget-matched scale, the way K-13 / the Rust
bot pace spend. Every 2 auctions the policy computes v1's marginal value gain(L) for all
26 letters (one `candidatesPlusOne` scan + 26 partitions with v1's hoard leftover, budget
800 nodes, 400 on racks > 18 tiles) and solves by bisection for a multiplier m such that
the projected spend over the remaining auctions — bidding gain(L) x m on every letter L,
weighted by the unseen pool and paying the market's expected Vickrey price
(`Brain2.projectedSpend`/`expectPay` on market.json rows, phase, live heat = EMA of
paid/medSecond starting at 1.45) — equals balance + incomeShare x (cashable word points of
the rack) x (bagLeft/totalAuctions). Bid = gain x m x mScale, then v1's existing
first-price shade, maxFrac, late fill (12 in last 16), market-median floor, minBid 1,
all-in on the last usable auction, cap at richest rival + 1, 0 on the final auction.
Words: v1 `words()` unchanged.

## 2. Files
- `src/variants/budget-pacing/policy.ts` — `makePolicy`, `BudgetPacer`, `BP_DEFAULTS`
  (= v1 `DEFAULT_PARAMS` + incomeShare 0.5, mScale 1.0, mMin 0.5, mMax 12, every 2,
  tableBudget 800, tableBudgetBig 400, heat0 1.45, heatWeight 0.12, useRivals false).
- `src/variants/budget-pacing/RESULT.md` — this file.
- Scratch (outside the repo): `.../scratchpad/bp_time.ts` (timing), `bp_confirm.sh`.

## 3. Evaluations run
All with `REPLAY_FILE=./replay_hack.json` unless marked strong; policy =
`REPLAY_POLICY=./variants/budget-pacing/policy.ts`; config JSON as shown. Machine was
shared with ~100 other replay processes (load 40-110 on 4 cores), hence the ms/match.

Smoke (train, seed 11, REPLAY_SEEDS=1, 30 matches):
- `policy:./variants/budget-pacing/policy.ts {} n=30: avg place 2.60 score 83.7 win 0.20 letters 12.5 endbal 18 places[1..7]=6,11,6,4,2,1,0 (278ms/match)`
- `v1 {} n=30: avg place 2.53 score 87.7 win 0.27 letters 12.7 endbal 23 places[1..7]=8,11,3,3,5,0,0 (145ms/match)`

v1 baseline, train, seed 11, REPLAY_SEEDS=4:
- `v1 {} n=236: avg place 2.13 score 91.9 win 0.43 letters 13.2 endbal 21 places[1..7]=102,67,29,19,12,5,2 (540ms/match)`

Matched hedge, test, seed 11, REPLAY_SEEDS=1 (same 58 matches, same seeds):
- `v1 {} n=58: avg place 1.95 score 90.8 win 0.36 letters 12.8 endbal 21 places[1..7]=21,27,5,3,1,1,0 (2437ms/match)`
- `policy:./variants/budget-pacing/policy.ts {} n=58: avg place 2.19 score 88.1 win 0.36 letters 13.1 endbal 17 places[1..7]=21,16,12,7,2,0,0 (3857ms/match)`

Train sweep, seed 11, REPLAY_SEEDS=2 (n=118; an 8-config x 4-seed sweep was lost to a
mis-targeted kill at 02:40 and re-run smaller):
- `v1 {} n=118: avg place 2.27 score 90.6 win 0.43 letters 12.9 endbal 21 places[1..7]=51,29,15,8,10,3,2 (6537ms/match)`
- `policy:./variants/budget-pacing/policy.ts {"mScale":0.8} n=118: avg place 2.36 score 87.4 win 0.34 letters 12.4 endbal 32 places[1..7]=40,36,22,7,6,6,1 (10047ms/match)`
- `policy:./variants/budget-pacing/policy.ts {"incomeShare":0.9} n=118: avg place 2.46 score 85.9 win 0.25 letters 12.9 endbal 18 places[1..7]=30,37,30,12,6,3,0 (10137ms/match)`
- `policy:./variants/budget-pacing/policy.ts {"mScale":1.2} n=118: avg place 2.67 score 81.4 win 0.20 letters 12.7 endbal 12 places[1..7]=24,33,31,22,5,2,1 (10198ms/match)`
- `policy:./variants/budget-pacing/policy.ts {} n=118: avg place 2.34 score 86.9 win 0.31 letters 12.9 endbal 19 places[1..7]=37,38,24,9,6,3,1 (10246ms/match)`
- `policy:./variants/budget-pacing/policy.ts {"incomeShare":0.3} n=118: avg place 2.26 score 87.5 win 0.32 letters 13.0 endbal 19 places[1..7]=38,39,25,8,5,2,1 (10277ms/match)`

Best train config `{"incomeShare":0.3}`, test, REPLAY_SEEDS=1 (same 58 matches as the v1
hedge lines above; launched 03:02):
- `policy:./variants/budget-pacing/policy.ts {"incomeShare":0.3} n=58: avg place 2.22 score 87.0 win 0.34 letters 12.9 endbal 19 places[1..7]=20,16,13,7,2,0,0 (1275ms/match)` (seed 11; v1 same matches 1.95)
- `policy:./variants/budget-pacing/policy.ts {"incomeShare":0.3} n=58: avg place 2.12 score 87.4 win 0.38 letters 13.0 endbal 19 places[1..7]=22,16,11,9,0,0,0 (1192ms/match)` (seed 23; v1 same matches 2.02)

Timing (scratch `bp_time.ts`, table refresh forced on EVERY call, machine shared with 8+
replays): 12-tile rack avg 31 ms / worst 76 ms; 20-tile avg 107 / worst 142 ms; 28-tile
avg 84 / worst 143 ms. Same script at load ~60: worst ~300 ms (contention, not code).

Confirmation of the default config `{}`, REPLAY_SEEDS=4 (test seed 11, test seed 23,
strong pool = `REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1 ... x 97 11`):
- NOT OBTAINED. Launched 02:40 under `timeout 900`; at 6-10 s/match (load ~110 on 4
  cores from ~100 concurrent replays) all three were killed at 15 min with no output. No
  time remained before the 03:15 stop to re-run 232-match evals. Re-run with
  `bash <scratchpad>/bp_confirm.sh '{}' default` (edit its `timeout 900` to 3600).

Matched hedge, test, seed 23, REPLAY_SEEDS=1 (same 58 matches):
- `v1 {} n=58: avg place 2.02 score 89.5 win 0.48 letters 12.9 endbal 23 places[1..7]=28,13,8,6,3,0,0 (2041ms/match)`
- `policy:./variants/budget-pacing/policy.ts {} n=58: avg place 2.14 score 87.9 win 0.40 letters 13.0 endbal 18 places[1..7]=23,14,11,10,0,0,0 (2577ms/match)`

## 4. Best configuration vs baselines
Default `{}` (incomeShare 0.5, mScale 1.0, mMin 0.5, mMax 12, every 2). Numbers are what
could be obtained before the stop; the 4-seed test/strong confirmations did not finish.

| eval | budget-pacing | v1 baseline (same matches/seeds) | BASELINES.txt (v1, 4 seeds) |
|---|---|---|---|
| test seed 11, 1 seed, n=58 | 2.19 (letters 13.1, endbal 17, score 88.1) | 1.95 (12.8, 21, 90.8) | 2.09 (n=232) |
| test seed 23, 1 seed, n=58 | 2.14 (letters 13.0, endbal 18, score 87.9) | 2.02 (12.9, 23, 89.5) | 2.08 (n=232) |
| strong pool | not run (no time) | — | 2.07 (n=388) |
| train seed 11, 2 seeds, n=118 | 2.34 (`{}`), 2.26 (`incomeShare 0.3`), 2.36 (`mScale 0.8`), 2.46 (`incomeShare 0.9`), 2.67 (`mScale 1.2`) | 2.27 | — |
| `incomeShare 0.3`, test seed 11 / 23, 1 seed, n=58 | 2.22 / 2.12 | 1.95 / 2.02 | 2.09 / 2.08 |

Letter preference check: letters won 13.1 vs 12.8 and points per letter acquired 6.7 vs
7.1 (score/letters) on the matched test-11 sample — it buys about the same number of
tiles, pays more for them (endbal 17 vs 21) and converts them slightly worse. It did
not degrade into v2-style indiscriminate buying (letter counts are flat, not inflated),
but the extra spend did not buy better letters either.

## 5. Verdict
LOSS (small samples, but consistent in sign): -0.24 on the matched test-11 sample and
-0.12 on the matched test-23 sample (n=58 each, SE ~0.16 per side; pooled n=116: 2.17 vs
1.99, -0.18), -0.07 on the 30-match smoke. On both test seeds it buys the same number of
letters, ends with ~5 fewer coins and scores ~2 fewer points. Nothing suggests the
budget-matched scale beats v1's kappa x cash x ramp; the mechanism spends the same
budget earlier and more evenly, which in these replays is slightly worse, consistent
with the earlier finding that higher early spend (kappa 3-4) hurts.
The train sweep is monotone in spend: every knob that raises m (mScale 1.2, incomeShare
0.9) is clearly worse (2.46-2.67 vs 2.27), lowering it (mScale 0.8) under-spends (endbal
32) and is also worse, and the only config that ties v1 on train (incomeShare 0.3, 2.26
vs 2.27) still scores 3 points less per match. There is no setting of this family that
is ahead; the best case is parity on train, and that config then loses out of sample too
(incomeShare 0.3 on test: 2.22 vs 1.95 and 2.12 vs 2.02, pooled -0.19). Verdict: LOSS,
margin -0.18 to -0.19 pooled over both test seeds (n=116) for both the default and the
best train config; every other config is worse. Caveat: 1-seed, n=58-per-seed samples
(SE ~0.16), because the 4-seed confirmations were lost to CPU contention — but the
sign is the same on every sample taken (smoke, train, test 11, test 23) and the sweep
is monotone, so the conclusion is unlikely to flip. Do not ship.

## 6. Risks
- Compute: bid() = v1's two 3000-node partitions + (every 2nd auction) 27 partitions at
  800 nodes (400 on racks > 18 tiles) + ~25 bisection steps x 26 closed-form expectPay.
  Measured with the table refresh FORCED on every call on a machine running 8 other
  replays: 12-tile rack avg 31 ms / worst 76 ms, 20-tile avg 107 / worst 142 ms, 28-tile
  avg 84 / worst 143 ms (before the big-rack budget cut). Under heavier contention
  (load 60+ on 4 cores) the same script showed ~300 ms worst — so the margin to the
  150 ms budget is thin on a loaded box; live, `every` 3 and `tableBudget` 500 would be
  the safe setting.
- Data: uses only `State` fields (rack, balance, bagLeft, totalAuctions, unseen,
  maxRivalBalance) plus the shipped `market.json`; nothing from the match record. Live
  heat comes from observePrice (paid prices are public). `useRivals` (bots.json) is off.
- Heads-up (2 players, 88 auctions): phase() and projection scale with totalAuctions, but
  market.json rows are 6-seat prices; with one rival the projected spend is overstated,
  so m is too low early. The late fill / all-in / minBid 1 behaviour from v1 is kept.
- The projection assumes we bid gain x m on every letter; v1's floors (market median,
  late fill) add spend the solver does not see, so the real spend runs above budget late.

## 7. How to enable
Point the client at `makePolicy` from `src/variants/budget-pacing/policy.ts` (same
`Policy` interface as the replay arena: `bid(s)`, `words(s)`, `observePrice(...)`,
`reset()`), or in `strategy.ts` replace the `cash`/`ramp` lines of `Brain.bid` with
`amt = gain * m * mScale` where m comes from `BudgetPacer.refresh(s)` (needs `State`
with `unseen`/`totalAuctions`, and `observePrice` wired to the auction results).
