# place-aware — endgame layer that values points by their effect on finishing PLACE

## 1. Idea and mechanism
The tournament scores finishing place, not points. In the last `pwN`=20 auctions the policy models every
rival's final score as Normal(mu_i, sd) with `mu_i = a(bagLeft) + b(bagLeft)*scoreNow_i + c(bagLeft)*spentNow_i`
(spentNow inferred live from public data: `100 + score - balance`), fitted by least squares on the train half
of `replay_hack.json` (table in `policy.ts`; at bagLeft 20: `29.8 + 0.74*score + 0.06*spent`, sd 25; at
bagLeft 1: `2.2 + 0.89*score + 0.06*spent`, sd 7.5 — strong regression to the mean, spend is nearly
irrelevant). Our projected final X = score + exact flush value of the rack (best partition, beta=1) +
`futK`*min(balance, 13*bagLeft). The marginal place value of one point is the summed rival density at X;
the v1 bid (before market floor / late fill / all-in, which are kept as insurance) is multiplied by
`clamp(density/pwRef, pwMin=0.6, pwMax=1.8)^pwGamma`: push in tight races, save nothing-worth cash when the
place is decided (1st by a margin or hopelessly behind). Optional `bankN`/`bankP`: when P(1st) >= 0.85,
bank 7+ letter words at once instead of holding to the flush (reinvest, no flush-timing risk).

## 2. Files
- `src/variants/place-aware/strategy.ts` — copy of v1 with two hooks in `View`: `placeMult` (applied to the
  pre-floor bid amount) and `bankNow`/`bankLen` (lowers the mid-match hold length).
- `src/variants/place-aware/policy.ts` — the place model (`placeView`), parameters (`DEFAULT_PLACE`), policy
  wrapper; `PA_DEBUG=1` prints a histogram of the multiplier and of our expected place.
- Scratch (not in repo): `scratchpad/pa_fit.ts` (the regression), `pa_time.ts`/`pa_time2.ts` (timing).

## 3. Evaluations run
All with `REPLAY_FILE=./replay_hack.json REPLAY_POLICY=./variants/place-aware/policy.ts` unless noted; `x 200 <seed>`.
Baselines (v1, `src/variants/BASELINES.txt`): test s11 `avg place 2.09 ... places=93,77,28,22,6,6,0`; test s23
`avg place 2.08 ... places=103,58,37,23,5,6,0`; strong `avg place 2.07 ... places=157,121,53,39,18,0,0`.

Model fit (train half, `pa_fit.ts`, rows = 6 rivals x 59 matches): see table in `policy.ts`; residual sd of
the rival-final estimate 30 (bagLeft 30) / 25 (20) / 16 (10) / 7.5 (1) vs naive "final = current" sd 49/36/20/8.

Diagnostic (train, 1 seed, 40 matches, `PA_DEBUG=1`, `{"pwN":20,"bankN":20}`):
`avg place 2.20 score 89.3 win 0.38 letters 12.9 endbal 22 places[1..7]=15,10,9,4,2,0,0` — multiplier
histogram over the 840 in-window bids: 0.6:208 0.7:75 0.8:112 0.9:79 1.0:77 1.1:68 1.2:62 1.3:41 1.4:26 1.5:19
1.6:18 1.7:25 1.8:30 (25% of in-window bids hit the "decided" clamp, 4% the "tight race" clamp); our
expected place at bid time 1:66 2:304 3:230 4:178 5:53 6:9; the bank rule fired 15 times in 40 matches.

Train split, seed 11, `REPLAY_SEEDS=4` (59 matches x 4):
- layer OFF (= exact v1 through this policy), `{"pwN":0}`:
  `policy:./variants/place-aware/policy.ts {"pwN":0} n=236: avg place 2.13 score 91.9 win 0.43 letters 13.2 endbal 21 places[1..7]=102,67,29,19,12,5,2 (2867ms/match)`
- layer ON, defaults `{"pwN":20}`:
  `policy:./variants/place-aware/policy.ts {"pwN":20} n=236: avg place 2.08 score 91.3 win 0.42 letters 13.1 endbal 22 places[1..7]=99,66,44,15,6,5,1 (2954ms/match)`
  (-0.05 place, within noise; 4th-7th finishes 38 -> 27, 3rds 29 -> 44, 1st/2nd 169 -> 165; -0.6 points)
- push-only (multiplier clamped to [1.0, 1.8]: never bids below v1), `{"pwN":20,"pwMin":1.0}`:
  `policy:./variants/place-aware/policy.ts {"pwN":20,"pwMin":1} n=236: avg place 2.08 score 92.3 win 0.42 letters 13.3 endbal 20 places[1..7]=100,72,32,18,7,6,1 (2069ms/match)`
  (-0.05 place vs off, +0.4 points, +0.1 letters, endbal 21 -> 20, 4th-7th 38 -> 32)

Test split, `REPLAY_SEEDS=4` (58 matches x 4), `{"pwN":20}`:
- seed 11: `policy:./variants/place-aware/policy.ts {"pwN":20} n=232: avg place 2.19 score 88.7 win 0.38 letters 12.7 endbal 22 places[1..7]=88,74,33,21,8,8,0 (3256ms/match)`
  vs baseline `2.09 ... 93,77,28,22,6,6,0`: +0.10 place (worse), -1.2 points, 4th-7th 34 -> 37. The train tail
  reduction does not transfer.
- seed 23: `policy:./variants/place-aware/policy.ts {"pwN":20} n=232: avg place 2.13 score 89.1 win 0.41 letters 12.7 endbal 23 places[1..7]=95,70,31,21,9,6,0 (3279ms/match)`
  vs baseline `2.08 ... 103,58,37,23,5,6,0`: +0.05 place (worse, within noise), -0.9 points, 1sts 103 -> 95.
- seed 11 with the bank rule, `{"pwN":20,"bankN":20}` (bank 7+ letter words when P(1st) >= 0.85):
  `policy:./variants/place-aware/policy.ts {"pwN":20,"bankN":20} n=232: avg place 2.19 score 88.7 win 0.38 letters 12.7 endbal 22 places[1..7]=88,74,33,21,8,8,0 (2117ms/match)`
  — identical to the line without it: banking a secured 7 early never changed a final result.

Strong pool (`REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1 REPLAY_SEEDS=4`, `x 97 11`), `{"pwN":20}`:
- `policy:./variants/place-aware/policy.ts {"pwN":20} n=388: avg place 2.09 score 98.7 win 0.40 letters 14.5 endbal 20 places[1..7]=154,121,60,33,19,1,0 (2193ms/match)`
  vs baseline `2.07 ... 157,121,53,39,18,0,0`: +0.02 place (within noise), -1.1 points, -0.2 letters.

Push-only `{"pwN":20,"pwMin":1.0}` on the test split (launched 03:00, after the train result above):
- seed 11: `policy:./variants/place-aware/policy.ts {"pwN":20,"pwMin":1} n=232: avg place 2.15 score 89.4 win 0.39 letters 12.8 endbal 20 places[1..7]=91,73,33,20,8,7,0 (737ms/match)`
  vs baseline `2.09 ... 93,77,28,22,6,6,0`: +0.06 place (worse, within noise), -0.5 points. The train gain was noise.
- seed 23: `policy:./variants/place-aware/policy.ts {"pwN":20,"pwMin":1} n=232: avg place 2.09 score 89.7 win 0.42 letters 12.9 endbal 20 places[1..7]=98,67,32,23,7,5,0 (755ms/match)`
  vs baseline `2.08 ... 103,58,37,23,5,6,0`: +0.01 place (neutral), -0.3 points, spends 2 more coins for nothing.
Not run (out of time): push-only on the strong pool; any tuning of pwRef/pwMax/futK; the `pwN:12` window.

## 4. Best configuration vs baselines
Three configurations reached the test split: the defaults `{"pwN":20}` (pwRef 0.06, clamp [0.6, 1.8],
gamma 1, futK 0.3, bank off), the same plus the bank rule, and push-only. None beats the baseline.

| | test seed 11 | test seed 23 | strong pool |
|---|---|---|---|
| v1 baseline | 2.09 (93,77,28,22,6,6,0) | 2.08 (103,58,37,23,5,6,0) | 2.07 (157,121,53,39,18,0,0) |
| place-aware `{"pwN":20}` | 2.19 (88,74,33,21,8,8,0) | 2.13 (95,70,31,21,9,6,0) | 2.09 (154,121,60,33,19,1,0) |
| push-only `{"pwN":20,"pwMin":1.0}` | 2.15 (91,73,33,20,8,7,0) | 2.09 (98,67,32,23,7,5,0) | not run |

## 5. Verdict
**LOSS** (small) for the layer as designed: +0.10 on test seed 11, +0.05 on test seed 23 and +0.02 on the
strong pool (worse on all three; the threshold for a win was -0.10 on both test seeds), about -1 point of
score and -0.1 letters per match. The train split had shown -0.05 place and
a shrunken 4th-7th tail (38 -> 27), which did not transfer: on test the tail is unchanged (34 -> 37, 29 -> 36)
and 1st places fell (93 -> 88, 103 -> 95). Mechanism, as far as the data shows: with rival-final residual sd of
25 points at 20 auctions left (16 at 10 left), the model mostly declares matches "decided" (25% of in-window
bids sit at the 0.6 clamp, 4% at 1.8), so the layer's main effect is to bid *less* for 10-20 auctions and let
the late fill / all-in spend the saved cash at the very end on fewer, worse tiles. In the arena that costs
points without buying place. The "clinch / climb" cases the idea targets are too rare and too uncertain at
this horizon to pay for the mis-classified ones. Place-awareness is not a free lunch on top of a points
maximizer here; if anything the data says: keep buying tiles in contested-looking endgames, i.e. a
push-only variant (`pwMin: 1.0`) looked like the better form on train (2.08, +0.4 points) but it too is
no better on test (seed 11: 2.15 vs 2.09; seed 23: 2.09 vs 2.08 — NEUTRAL, -0.3 to -0.5 points). Both forms
fail the win criterion; neither should go live. Net: full layer LOSS (+0.10 / +0.05 / +0.02), push-only NEUTRAL.
The bank rule (cash a secured 7+ early) is a no-op in the arena: identical output with and without it on
test seed 11. In the arena the cash it frees late buys nothing extra; live, its only value is removing the
flush-timing risk (client hiccup on the last auction), which the arena cannot measure.

## 6. Risks
- Compute: the layer adds one `bestPartition` (budget 3000) per auction inside the window (cached per
  auction, recomputed after a play). Measured on the same loaded box, back to back, on a 28-tile rack at
  bagLeft 10: `bid()` 973-1247 ms (v1 alone) vs 1203-1212 ms (layer on), i.e. +0-25% of v1's own cost; the
  absolute numbers are ~10x inflated by ~100 concurrent replays (load average 110 on 4 cores; v1's normal
  baseline is 128 ms/match). Under normal load the layer should stay within the 150 ms budget wherever v1
  does; to be safe lower the flush-estimate budget (use `bestPartition(..., 1000)` in `flushValue`).
- Live data: needs `rivals[].balance`, `rivalScores`, `score`, `auctionIndex` from the client. If any is
  missing `placeView` returns null and the policy degrades to exact v1 behaviour.
- The rival-final model is fitted on 6-seat HackUTD tables (archive). In elimination rounds (shrinking
  tables) and the 2-player final (88 auctions) the intercepts a(bagLeft) are wrong (fewer rivals, more
  auctions): the layer is only clamped to [0.6, 1.8] of v1, so the damage is bounded, but for heads-up
  set `pwN: 0` unless re-fitted. The objective is expected place; in elimination rounds the real objective
  is P(not last), which the same machinery can give (sum only over the rival density below us) but was not
  evaluated (the arena's 7th place is never reached by v1).
- The arena ranks us against rivals' archived final scores, so "saving cash when decided" cannot gain
  points there; the only measurable upside is from pushing bids in contested races.

## 7. How to enable (not recommended: see verdict)
Run with `REPLAY_POLICY=./variants/place-aware/policy.ts` and `{"pwN":20}` (default). To enable in the
live bot: add the `placeMult`/`bankNow` hooks from `variants/place-aware/strategy.ts` to `src/strategy.ts`
(two 3-line edits) and compute `placeMult` via `placeView(state, brain.plan(rack, 0).score, DEFAULT_PLACE)`
before calling `brain.bid`. `{"pwN":0}` turns the layer off (exact v1).
