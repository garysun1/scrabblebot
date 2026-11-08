# endgame-mc — exact-horizon Monte Carlo letter values for the last K auctions

## 1. Idea and mechanism
In the last K auctions the end is exactly known and the unseen pool is small, so instead of
v1's fading hoard heuristic a letter is valued as  v(L) = E_F[ P(rack+L+F) - P(rack+F) ],
where F = tiles we still win in the remaining *usable* auctions (bagLeft-1 draws, sampled without
replacement from `State.unseen` minus the letter on the block, each kept with probability egP=0.3)
and P = exact best partition (leftover tiles worth 0). Common random numbers (same F for both
partitions) keep the estimate low-variance. Points -> coins either with v1's own
kappa x cash x late-ramp (mode `kappa`: isolates the valuation change) or with a budget-share rule
bid = balance x v / (v + egP x (bagLeft-1) x vbar) that spends the whole balance over the remaining
usable auctions and tends to all-in at the end (mode `share`). v1's late-fill (12) and market-median
floors are kept; bagLeft <= 1 and bagLeft > K are left to v1 unchanged (see section 6 for why all-in
at bagLeft <= 1 is already right).

## 2. Files
- `src/variants/endgame-mc/policy.ts` — `EndgameBrain extends Brain` (v1) with `mcValue()` and
  `bidState()`; `makePolicy(d, over, rnd)` splits `over` into v1 `Params` and `EgParams`
  (`egK, egP, egN, egBudget, egMode, egMult, egFloor, egMarket, egMinV`).
- `src/variants/endgame-mc/RESULT.md` — this report.

## 3. Evaluations
Machine state during all runs: 4 cores, load average 60-110 (other agents' replays), so all
wall-clock figures (ms/match) are inflated 25-90x (v1 ran at 11.8 s/match instead of its idle
0.13 s) and SEEDS had to be cut; see each line.
Pool: `REPLAY_FILE=./replay_hack.json` unless noted. All `REPLAY_POLICY=./variants/endgame-mc/policy.ts`
lines are the variant; `./variants/example/policy.ts` lines are the v1 baseline run under the same
conditions (identical matches and per-match RNG, so comparisons are paired).

Smoke (train, SEEDS=1, 20 matches, seed 11, `{"egK":8}` = egN 24, budget 800, mode kappa):
```
policy:./variants/endgame-mc/policy.ts {"egK":8} n=20: avg place 2.25 score 89.0 win 0.35 letters 13.6 endbal 14 places[1..7]=7,7,2,2,2,0,0 (947ms/match)
```
Train baseline (REPLAY_SPLIT=train REPLAY_SEEDS=2, seed 11):
```
policy:./variants/example/policy.ts {} n=118: avg place 2.27 score 90.6 win 0.43 letters 12.9 endbal 21 places[1..7]=51,29,15,8,10,3,2 (1034ms/match)
```
Paired runs (REPLAY_SEEDS=1; variant config `{"egK":8,"egN":16,"egBudget":500}` = mode kappa unless
noted). SEEDS had to be 1 because the machine ran ~230 replay processes on 4 cores (load 100-110;
v1 took 11.8 s/match wall instead of 0.13 s). All lines finished 02:54-02:59 UTC; raw outputs are in
`/tmp/claude-0/-home-user-scrabblebot/f70bb7c9-93b8-55b6-a54d-fb4c42344a5b/scratchpad/p_*.txt`.
Because the per-match RNG is seeded by (seed, k, match index), baseline and variant see identical
starting racks and tie-breaks, so each pair is a paired comparison.

test split seed 11 (REPLAY_SPLIT=test REPLAY_SEEDS=1, x 200 11):
```
policy:./variants/example/policy.ts {} n=58: avg place 1.95 score 90.8 win 0.36 letters 12.8 endbal 21 places[1..7]=21,27,5,3,1,1,0 (12567ms/match)
policy:./variants/endgame-mc/policy.ts {"egK":8,"egN":16,"egBudget":500} n=58: avg place 1.98 score 90.5 win 0.40 letters 13.1 endbal 16 places[1..7]=23,22,8,2,2,1,0 (15667ms/match)
```
test split seed 23 (REPLAY_SPLIT=test REPLAY_SEEDS=1, x 200 23):
```
policy:./variants/example/policy.ts {} n=58: avg place 2.02 score 89.5 win 0.48 letters 12.9 endbal 23 places[1..7]=28,13,8,6,3,0,0 (12331ms/match)
policy:./variants/endgame-mc/policy.ts {"egK":8,"egN":16,"egBudget":500} n=58: avg place 1.97 score 89.7 win 0.48 letters 13.3 endbal 16 places[1..7]=28,14,9,4,3,0,0 (15516ms/match)
```
strong pool (REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1 REPLAY_SEEDS=1, x 97 11):
```
policy:./variants/example/policy.ts {} n=97: avg place 1.98 score 102.7 win 0.46 letters 14.9 endbal 19 places[1..7]=45,28,9,11,4,0,0 (9570ms/match)
policy:./variants/endgame-mc/policy.ts {"egK":8,"egN":16,"egBudget":500} n=97: avg place 1.94 score 102.6 win 0.48 letters 15.2 endbal 16 places[1..7]=47,28,8,9,5,0,0 (9763ms/match)
```
train split seed 11 (REPLAY_SPLIT=train REPLAY_SEEDS=1, x 200 11) — sweep:
```
policy:./variants/example/policy.ts {} n=59: avg place 2.14 score 93.1 win 0.46 letters 13.0 endbal 23 places[1..7]=27,16,5,4,6,1,0 (11793ms/match)
policy:./variants/endgame-mc/policy.ts {"egK":8,"egN":16,"egBudget":500} n=59: avg place 1.98 score 93.9 win 0.47 letters 13.6 endbal 16 places[1..7]=28,16,6,6,3,0,0 (15199ms/match)
policy:./variants/endgame-mc/policy.ts {"egK":6,"egN":16,"egBudget":500} n=59: avg place 2.00 score 94.0 win 0.49 letters 13.6 endbal 18 places[1..7]=29,16,4,6,3,1,0 (14378ms/match)
policy:./variants/endgame-mc/policy.ts {"egK":10,"egN":16,"egBudget":500} n=59: avg place 2.00 score 93.6 win 0.51 letters 13.6 endbal 16 places[1..7]=30,15,3,7,3,1,0 (15580ms/match)
policy:./variants/endgame-mc/policy.ts {"egK":10,"egMode":"share","egN":16,"egBudget":500} n=59: avg place 2.14 score 92.0 win 0.47 letters 13.3 endbal 21 places[1..7]=28,13,6,6,6,0,0 (15700ms/match)
```
Aborted (would not have finished under the load; killed at 02:43 to free CPU): SEEDS=4 train runs of
K=6/10 x kappa/share with egN=24/budget 800, and SEEDS=4 test-11/test-23/strong runs of `{"egK":8}`.

## 4. Best configuration vs baselines
A-priori default (chosen before any result): `{"egK":8,"egMode":"kappa","egN":16,"egBudget":500}`.

| run | v1 baseline (BASELINES.txt, SEEDS=4, n=232/388) | v1 paired (SEEDS=1, same matches as variant) | endgame-mc |
|---|---|---|---|
| test seed 11 | 2.09 | 1.95 (n=58) | 1.98 (n=58)  (+0.03) |
| test seed 23 | 2.08 | 2.02 (n=58) | 1.97 (n=58)  (-0.05) |
| strong pool  | 2.07 | 1.98 (n=97) | 1.94 (n=97)  (-0.04) |
| train seed 11 (tuning split) | — | 2.14 (n=59) | K=8: 1.98 (-0.16), K=6: 2.00 (-0.14), K=10: 2.00 (-0.14), K=10 share: 2.14 (0.00) |

Pooled out-of-sample paired difference (test 11 + test 23 + strong, n=213): about -0.02 places.
The `share` pricing mode spent *less* than v1 (endbal 21, letters 13.3) because the expected value of
future wins in the denominator is large on a big rack; it gave exactly the baseline place. All of the
(train-only) gain comes from mode `kappa`, i.e. from the MC *valuation* with v1's own coin pricing.

Consistent secondary effects in every paired run: +0.3..0.6 letters won per match, 5-7 fewer coins
left at the end (16 vs 21-23), score within +-1 point. So the override does what it was built to do
(spends the endgame balance on tiles the exact partition can use) without that turning into places.

## 5. Verdict
NEUTRAL. Out of sample the paired differences are +0.03 (test seed 11), -0.05 (test seed 23) and
-0.04 (strong pool): all inside the ~0.10 paired standard error at n=58-97 and far from the
>= 0.10-on-both-test-seeds bar; it does not lose on the strong pool. The train split showed
-0.14/-0.16/-0.14 for K=6/8/10 (n=59), which did not transfer, so at these sample sizes it reads as
noise plus at most a small real effect (the direction is 2-of-3 favourable out of sample, ~-0.02
pooled). Prior from the design agrees: the override touches at most 7 of 68 auctions and v1 is
already exact at bagLeft <= 2, so only bagLeft 4-8 (25-50% hoard weight in v1) had room to improve,
and the extra 0.3-0.6 letters it buys there are mostly short-word fodder. Not worth the compute risk
(section 6) for the live bot; if anyone wants to pursue it, the next step is a SEEDS=4 confirmation of
mode `kappa`, K=8, on an idle machine (~5 minutes), not more tuning.

## 6. Risks and analysis
- Compute (the main risk): timing script `scratchpad/eg_time.ts` on 28-tile racks, 110 decisions
  at bagLeft 10/8/6/4/2 with egN=24, budget 800: avg 2917 ms wall, worst 10.8 s — measured while the
  machine was 25-90x oversubscribed (load 100-110 on 4 cores; v1's replay slowed 90x in the same
  window), so the idle-core cost is somewhere between ~35 and ~120 ms per decision on average, with
  the worst case possibly above 150 ms. That is not comfortably inside the budget. The evaluated
  config (egN=16, budget 500) was re-timed at 03:01 UTC under load 47-53 (~12x oversubscribed):
  `{"egK":10,"egN":16,"egBudget":500} decisions=115 avg 636.8ms worst 1790.6ms`, i.e. roughly
  50 ms average and ~140 ms worst case per decision on an idle core — average is fine, the worst
  case sits at the budget. Re-time on an idle core before going live (`node_modules/.bin/tsx
  /tmp/claude-0/-home-user-scrabblebot/f70bb7c9-93b8-55b6-a54d-fb4c42344a5b/scratchpad/eg_time.ts`)
  and drop egN to 12 / budget to 400 if a decision exceeds ~100 ms. Only auctions with
  2 <= bagLeft <= K pay this cost; everything else is v1 (~2 ms). The cost is dominated by
  `Dict.candidates()` on the 28-30-tile rack once per sample, so a cheaper variant would compute
  candidates once for rack + L + all unseen tiles and `filter()` per sample.
- Live data: uses only `State.rack/balance/bagLeft/unseen/maxRivalBalance/firstPrice`; `unseen`
  is exactly what brain2 already computes live. Falls back to v1 if `unseen` is missing.
- Randomness: the MC uses the `rnd` passed to `makePolicy` (Math.random live); with egN=16 the bid
  has sampling noise of a few coins. Deterministic in replay (uses the arena's seeded rnd).
- bagLeft <= 1 (verified by reasoning, not changed): the tile sold at bagLeft=1 is the last one
  that can ever be played, and coins have no use afterwards, so under Vickrey the dominant bid is
  the full balance capped at richest rival + 1 whenever the exact-partition gain is > 0 (v1 already
  computes that gain with beta=1, i.e. exactly, at bagLeft=1). A value-based bid there can only
  lose wanted tiles to save worthless coins; the cap costs nothing because higher bids buy nothing.
  bagLeft=2: v1 is also exact (beta(1)=1) but ignores the one remaining usable draw; bagLeft=3
  still carries 6% hoard. The MC adds those draws, which is the only real difference at 2-3.
- Heads-up (2 seats, 88 auctions): `unseen` is larger (rival holds more), egP=0.3 may be too low
  (we win ~half of contested letters heads-up); the share mode's all-in tendency is riskier when
  the single rival also bids never on the last auction. Keep mode `kappa` for the final.

## 7. How to enable
Use `src/variants/endgame-mc/policy.ts` as the policy (`makePolicy(d, over, rnd)`), or port
`EndgameBrain.mcValue/bidState` into `src/strategy.ts` and call `bidState` instead of `bid` when
`2 <= bagLeft <= egK`. Params via `over`: `{"egK":8,"egN":16,"egBudget":500,"egMode":"kappa"}`.
`egK: 0` disables it (pure v1).
