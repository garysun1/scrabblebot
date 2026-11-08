# lookahead-play — RESULT

## 1. Idea and mechanism
v1 bidding is kept byte-for-byte (the policy wraps `Brain` from `src/strategy.ts`); only the
play/hold decision changes. For each candidate play (7+ letter words in the rack, up to 3) a small
Monte Carlo over k sampled unseen tiles F (k = round(0.25 x bagLeft), clamped to [1, 8]) compares
  hold = E[exact(rack + F)]   vs   play = reward(w) + E[exact(rack - w + F)] + cashValue(reward(w))
where exact() is the hoard-free best partition (budget 300, top-250 playable classes by reward) and
cashValue = cashRate x min(reward, spendRate x bagLeft - balance) (0 when we already hold more cash
than the remaining auctions can absorb, or bagLeft < 4). Play when play - hold > margin (2 points).
Since hold >= play without the cash term (the held word is always still available), the only thing
that ever triggers a mid-match play is cash we can still convert; short words keep v1's rule
(hold; 5+ only when starved), so this cannot repeat v2's cash-everything-early failure.
Also tested: auto-play of 8+ letter words; implemented but unevaluated: a starve threshold that shrinks with bagLeft.

## 2. Files
- `src/variants/lookahead-play/policy.ts` — `makePolicy` (LookBrain extends Brain; `decide()` is the new words()).
- `src/variants/lookahead-play/time.ts` — timing harness for 28-tile racks.
- `src/variants/lookahead-play/RESULT.md` — this file.

## 3. Evaluations
Context: the box was at load average 70-110 on 4 cores (≈150-190 replay processes from all agents) for
the whole window, so one 232-run eval needed 15-60 min wall. Three full REPLAY_SEEDS=4 runs finished (train
seed 11 MC + v1, test seeds 11 and 23 MC); the strong pool did not. The quick runs are REPLAY_SEEDS=1 (58
matches per split/seed) done as PAIRED comparisons: the MC policy and the same wrapper with `mcOn:0`
(= v1 words()) on the identical matches and identical starting racks, so the difference is far less noisy
than the raw n suggests.
All: `REPLAY_FILE=./replay_hack.json REPLAY_POLICY=./variants/lookahead-play/policy.ts QUIET=1 tsx src/replay.ts x 200 <seed> <json>`.

Test split, seed 11, REPLAY_SEEDS=1 (a-priori default config vs v1 words):
- `policy:./variants/lookahead-play/policy.ts {"samples":8} n=58: avg place 2.34 score 85.1 win 0.29 letters 12.9 endbal 20 places[1..7]=17,19,9,11,2,0,0 (4150ms/match)`
- `policy:./variants/lookahead-play/policy.ts {"mcOn":0,"samples":8} n=58: avg place 1.95 score 90.8 win 0.36 letters 12.8 endbal 21 places[1..7]=21,27,5,3,1,1,0 (4670ms/match)`

Test split, seed 23, REPLAY_SEEDS=1:
- `policy:./variants/lookahead-play/policy.ts {"samples":8} n=58: avg place 2.36 score 85.0 win 0.31 letters 12.9 endbal 22 places[1..7]=18,17,10,11,1,1,0 (4335ms/match)`
- `policy:./variants/lookahead-play/policy.ts {"mcOn":0,"samples":8} n=58: avg place 2.02 score 89.5 win 0.48 letters 12.9 endbal 23 places[1..7]=28,13,8,6,3,0,0 (4683ms/match)`

(`{"samples":8}` is the default value, i.e. the a-priori config `{}`; `mcOn:0` reproduces v1's word rule.)

Train split, seed 11, REPLAY_SEEDS=4 (full size, finished 02:51):
- `policy:./variants/lookahead-play/policy.ts {} n=236: avg place 2.40 score 85.9 win 0.31 letters 13.1 endbal 19 places[1..7]=73,68,49,29,8,8,1 (3314ms/match)`
- `policy:./variants/lookahead-play/policy.ts {"mcOn":0} n=236: avg place 2.13 score 91.9 win 0.43 letters 13.2 endbal 21 places[1..7]=102,67,29,19,12,5,2 (3323ms/match)`

Test split, seed 11, REPLAY_SEEDS=4 (full size, finished 02:54; compare BASELINES.txt v1 2.09 / 89.9 / 12.8 / 21):
- `policy:./variants/lookahead-play/policy.ts {} n=232: avg place 2.32 score 85.7 win 0.32 letters 12.8 endbal 20 places[1..7]=74,73,39,34,7,4,1 (3443ms/match)`

Test split, seed 23, REPLAY_SEEDS=4 (full size, finished 02:54; compare BASELINES.txt v1 2.08 / 90.0 / 12.9 / 22):
- `policy:./variants/lookahead-play/policy.ts {} n=232: avg place 2.32 score 85.8 win 0.36 letters 13.0 endbal 21 places[1..7]=83,65,36,31,9,7,1 (3426ms/match)`

Strong pool (`REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1 REPLAY_SEEDS=4 x 97 11`,
finished 02:58; compare BASELINES.txt v1 2.07 / 99.8 / 14.7 / 19):
- `policy:./variants/lookahead-play/policy.ts {} n=388: avg place 2.28 score 95.8 win 0.34 letters 14.4 endbal 19 places[1..7]=133,115,69,45,23,0,3 (2607ms/match)`

Launched but killed at 02:43 to save CPU (REPLAY_SEEDS=4, train seed 11): `{"cashRate":0}`, `{"margin":6}`,
`{"mcOn":0,"autoPlayLen":8}`, `{"mcOn":0,"starveK":1}`; also a test-11 `{"mcOn":0}` sanity run.
Train-split REPLAY_SEEDS=1 exploratory runs (`{"mcOn":0}`, `{"cashRate":0.1,"margin":3}`, `{"mcOn":0,"autoPlayLen":8}`)
were launched at 02:48; see the addendum at the end if they landed.

## 4. Best configuration vs baselines
No configuration beat v1. The a-priori config (cashRate 0.3, spendRate 3, margin 2, k = 0.25 x bagLeft
capped at 8, 8 samples, budget 300):

| | lookahead-play `{}` | v1 words (`mcOn:0`, same matches) | BASELINES.txt v1 (SEEDS=4) |
|---|---|---|---|
| test seed 11 | 2.34 (score 85.1, letters 12.9, endbal 20) | 1.95 (90.8, 12.8, 21) | 2.09 (89.9, 12.8, 21) |
| test seed 23 | 2.36 (score 85.0, letters 12.9, endbal 22) | 2.02 (89.5, 12.9, 23) | 2.08 (90.0, 12.9, 22) |
| test seed 11, SEEDS=4, n=232 | 2.32 (score 85.7, letters 12.8, endbal 20) | — | 2.09 (89.9, 12.8, 21) |
| test seed 23, SEEDS=4, n=232 | 2.32 (score 85.8, letters 13.0, endbal 21) | — | 2.08 (90.0, 12.9, 22) |
| train seed 11, SEEDS=4, n=236 | 2.40 (score 85.9, letters 13.1, endbal 19) | 2.13 (91.9, 13.2, 21) | — |
| strong pool, SEEDS=4, n=388 | 2.28 (score 95.8, letters 14.4, endbal 19) | — | 2.07 (99.8, 14.7, 19) |

## 5. Verdict
LOSS for the idea as specified (a-priori config). Full size (REPLAY_SEEDS=4): test seed 11 2.32 vs 2.09
(-0.23), test seed 23 2.32 vs 2.08 (-0.24), strong pool 2.28 vs 2.07 (-0.21), train seed 11 2.40 vs 2.13
(-0.27). Paired n=58: -0.39 (seed 11), -0.34 (seed 23). About -4 to -6 score points per match everywhere,
with letters won and end balance unchanged.
The conservative variant (`cashRate 0.1, margin 3`, chosen on train) is NEUTRAL on both test seeds (-0.02/-0.05
places, -1 to -1.4 score) — it barely fires. "Cash 8+ letter words at once" is a paired LOSS of 0.37 on train.
No configuration meets the win criterion (>= 0.10 better on both test seeds). Mechanism, from the numbers: playing 7s mid-match raised letters won by only 0.0-0.1 and
left the end balance unchanged (20-22 vs 21-23) — v1's bidder does not convert extra cash into tiles
(its cash factor is sqrt-shaped and capped, and the market floor dominates mid-match bids), so the cash
term in E[play] was fiction while the option value of the held word (~5 points: growing to an 8 or
re-partitioning with later tiles) is real. Without the cash term the model itself says never play early
(hold >= play by construction), which is exactly v1. Conclusion for the team: a mid-match play rule
can only pay if it is coupled to a bidder that actually spends the proceeds (the leaders end with 9-15
coins and 14-16 letters); on its own it is strictly negative. "Cash 8+ letter words at once" lost for the
same reason (paired -0.37 on train). The dynamic starve threshold (`starveK`) is implemented but its run
was killed for CPU and is unevaluated; it relies on the same cash conversion, so nothing suggests it
would flip the sign.

## 6. Risks
- Compute: measured with `time.ts` on random 28-tile racks while the box was at load ~70-90 (other
  agents' replays), so numbers are inflated 3-5x: MC decision worst 121 ms (avg well under), guarded
  by `mcTimeMs` 40 (stops sampling after 40 ms, min 2 samples; a single sample on a 28-tile rack can
  still take ~50 ms loaded). The first uncapped version took 842 ms — the fix was capping the MC
  partition search to the top 250 playable classes by reward. Note v1's own `bid()` measured 87-169 ms
  on the same 28-tile racks under the same load, i.e. the MC roughly doubles the per-auction cost on a
  huge rack; on normal 8-15 tile racks it is a few ms. The MC runs only when a 7+ letter word is in the
  rack. `words()` is called once per auction (before the bid), so worst case per auction is
  v1 bid + v1 plan + MC.
- Live data: uses only `State.rack/balance/bagLeft/unseen` — all available live (the live client must
  pass `unseen` like the arena does; if it is missing the MC is skipped and the policy degrades to v1).
- The cash term assumes coins can be reinvested at ~0.3 points/coin while bagLeft x 3 coins > balance;
  in heads-up (88 auctions, 2 players, many free tiles at minBid 1) cash is worth less, so the policy
  would play 7s slightly too eagerly there; set `cashRate` lower (0.15) or `spendRate` lower for the final.
- Replay approximation: rivals do not react to our cash-fuelled extra bids, so any gain from reinvesting
  is probably overstated by the arena, not understated.

## Addendum: train-split REPLAY_SEEDS=1 exploratory runs (seed 11, same 59 matches each)
- `policy:./variants/lookahead-play/policy.ts {"mcOn":0,"autoPlayLen":8} n=59: avg place 2.51 score 87.4 win 0.36 letters 13.0 endbal 20 places[1..7]=21,14,10,4,8,1,1 (2999ms/match)`
  ("cash 8+ letter words at once", otherwise pure v1): paired LOSS of 0.37 places / -5.7 score vs the line below.
- `policy:./variants/lookahead-play/policy.ts {"mcOn":0,"kMin":1} n=59: avg place 2.14 score 93.1 win 0.46 letters 13.0 endbal 23 places[1..7]=27,16,5,4,6,1,0 (3614ms/match)`
  (paired baseline = v1 words; `kMin:1` is the default, a no-op)
- `policy:./variants/lookahead-play/policy.ts {"cashRate":0.1,"margin":3} n=59: avg place 2.12 score 91.7 win 0.46 letters 12.9 endbal 22 places[1..7]=27,17,3,6,5,1,0 (3887ms/match)`
  (conservative MC: a third of the cash value, margin 3): paired NEUTRAL on place (-0.02), score -1.4. It fires
  rarely, so it is v1 with a small leak; not a win. Out-of-sample confirmation on test seeds 11/23 (paired with
  the L/N lines above):
- `policy:./variants/lookahead-play/policy.ts {"cashRate":0.1,"margin":3} n=58: avg place 1.93 score 89.4 win 0.36 letters 13.0 endbal 19 places[1..7]=21,25,9,2,0,1,0 (3322ms/match)`
  test seed 11, vs paired v1 1.95 / 90.8 / 12.8 / 21: place -0.02 (neutral), score -1.4, letters +0.2.
- `policy:./variants/lookahead-play/policy.ts {"cashRate":0.1,"margin":3} n=58: avg place 1.97 score 88.5 win 0.48 letters 13.0 endbal 22 places[1..7]=28,13,10,5,2,0,0 (3522ms/match)`
  test seed 23, vs paired v1 2.02 / 89.5 / 12.9 / 23: place -0.05 (neutral), score -1.0, letters +0.1.
  Conservative config summary: train -0.02, test11 -0.02, test23 -0.05 places (all inside the ~0.1 noise), score
  -1.0 to -1.4 everywhere. NEUTRAL, not a win; and it only "works" by almost never firing.

## 7. How to enable
Live: in `src/strategy.ts` replace `Brain.words()` with `LookBrain.decide()` from
`src/variants/lookahead-play/policy.ts` (it only needs `s.unseen` in addition to the v1 View) and add
`DEFAULT_LOOK` to the params; or point the client at `makePolicy` from this folder. Pure v1 behaviour is
`{"mcOn":0}`. Knobs: `cashRate`, `spendRate`, `margin`, `samples`, `kFrac`/`kMax`, `mcCands`, `mcTimeMs`,
`autoPlayLen` (8 = cash 8+ letter words at once), `starveK` (dynamic starve threshold).
