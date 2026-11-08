# group-phase-multipliers — RESULT

## 1. Idea and mechanism
Learn, rather than guess, how much to bid by letter group and match phase. The live
v1 brain is kept intact; its raw marginal-value bid `amt = gain * kappa * cash * ramp`
is multiplied by a 12-entry table `M[group][phase]` BEFORE the premium multiplier,
first-price shade, maxFrac cap, late fill, market floor, minBid and all-in (all kept
exactly as v1). Groups: vowels (AEIOU) / 1-point consonants (LNRST) / 2-4 point
(DGBCMPFHVWY) / 5+ point (KJXQZ). Phases: bagLeft > 45 / 15-45 / < 15. The table
was to be fitted by cross-entropy search on the train split of the HackUTD replay
pool (init 1.0, sd 0.15, pop 10, elite 3, REPLAY_SEEDS=2, seed 5, 4 generations) and
confirmed on test seeds 11/23 and the strong pool. M > 1 = v1 under-bids there,
M < 1 = over-bids. Note: because the market floor is not scaled, an entry < 1 only
bites where the raw bid is above the median winning bid (or gain < 2); the table can
express "bid further above the market" but not "bid below the market median".

## 2. Files created (all in `src/variants/group-phase-multipliers/`)
- `policy.ts` — `GroupPhaseBrain extends Brain` (v1) with `bid()` copied verbatim plus
  the one `amt *= M[groupOf(letter)][phaseOf(bagLeft)]` line; `makePolicy(d, over)`
  reads table keys `v_e, v_m, v_l, c1_e, c1_m, c1_l, c24_e, c24_m, c24_l, c5_e, c5_m,
  c5_l` (or `"M": [12]`), optional `floorScale` (also scale the market floor; default
  off, never evaluated), everything else passes through to v1 `Params`.
- `cem.ts` — CEM driver (3 concurrent replay processes, logs every candidate to `cem.log`).
- `analyze.ts` — OLS / correlations of avg place on the 12 multipliers over all
  evaluated candidates + elite-3 mean table. Output in `analysis.txt`.
- `confirm.sh` — runs test seed 11 / test seed 23 / strong pool for one table.
- Raw outputs: `cem.log`, `cem_stdout.txt`, `v1_train_ref.txt`, `analysis.txt`,
  `confirm_elite3.txt`.

## 3. Evaluations run (verbatim replay lines)

**Identity check** (policy with all-1.0 table must equal v1), REPLAY_FILE=./replay_hack.json
REPLAY_SPLIT=train REPLAY_SEEDS=2, seed 5:
```
v1 {} n=118: avg place 1.99 score 91.5 win 0.43 letters 13.4 endbal 19 places[1..7]=51,35,20,8,2,2,0 (339ms/match)
policy:./variants/group-phase-multipliers/policy.ts {} n=118: avg place 1.99 score 91.5 win 0.43 letters 13.4 endbal 19 places[1..7]=51,35,20,8,2,2,0 (701ms/match)
```
Identical, so any difference below is the table alone.

**CEM, generation 0** (train split, REPLAY_SEEDS=2, seed 5, candidates ~ N(1.0, 0.15) per
entry). The box was at load average 75-105 on 4 CPUs (other agents' replays), so each
118-run eval took ~6 min instead of ~40 s; only 6 of the 10 gen-0 candidates finished
before I had to stop the search at 02:56 UTC to leave time for confirmation. The planned
4 generations were NOT reached. All six lines (cand = sampled table):
```
cand 0: {"v_e":0.854,"v_m":1.071,"v_l":0.897,"c1_e":1.006,"c1_m":1.231,"c1_l":1.157,"c24_e":1.31,"c24_m":1.002,"c24_l":0.942,"c5_e":1.171,"c5_m":1.041,"c5_l":0.849} n=118: avg place 2.30 score 87.6 win 0.31 letters 13.0 endbal 20 places[1..7]=36,40,24,11,5,0,2
cand 1: {"v_e":1.148,"v_m":1.037,"v_l":1.202,"c1_e":1.111,"c1_m":1.19,"c1_l":1.033,"c24_e":0.996,"c24_m":1.261,"c24_l":0.941,"c5_e":1.343,"c5_m":1.158,"c5_l":1.109} n=118: avg place 2.19 score 88.7 win 0.35 letters 12.9 endbal 18 places[1..7]=41,38,24,7,7,0,1
cand 2: {"v_e":0.989,"v_m":0.883,"v_l":0.918,"c1_e":1.041,"c1_m":1.125,"c1_l":1.084,"c24_e":1.004,"c24_m":0.981,"c24_l":1.139,"c5_e":1.141,"c5_m":1.045,"c5_l":1.127} n=118: avg place 2.08 score 91.6 win 0.40 letters 13.3 endbal 19 places[1..7]=47,40,18,6,3,3,1
cand 3: {"v_e":1.112,"v_m":1.088,"v_l":1.244,"c1_e":1.012,"c1_m":1.01,"c1_l":1.197,"c24_e":1.285,"c24_m":1.187,"c24_l":0.946,"c5_e":0.826,"c5_m":1.137,"c5_l":1.295} n=118: avg place 2.24 score 88.2 win 0.31 letters 12.7 endbal 18 places[1..7]=37,41,20,16,3,1,0
cand 4: {"v_e":0.862,"v_m":1,"v_l":0.546,"c1_e":1.088,"c1_m":0.971,"c1_l":0.992,"c24_e":0.86,"c24_m":1.16,"c24_l":0.858,"c5_e":1.089,"c5_m":1.449,"c5_l":1.214} n=118: avg place 2.21 score 89.3 win 0.37 letters 12.5 endbal 20 places[1..7]=44,34,21,12,4,3,0
cand 5: {"v_e":0.848,"v_m":0.947,"v_l":1.146,"c1_e":0.816,"c1_m":0.974,"c1_l":0.959,"c24_e":1.2,"c24_m":1.126,"c24_l":0.806,"c5_e":1.237,"c5_m":0.903,"c5_l":1.184} n=118: avg place 2.05 score 90.8 win 0.42 letters 12.9 endbal 19 places[1..7]=50,33,22,10,0,1,2
```
Baseline on the same pool: **1.99**. Every one of the six random +-15% group x phase
reweightings lost on train, by 0.06 to 0.31 places (SE ~0.11 at n=118; cands 5 and 2
are within noise, cands 0/1/3/4 are clearly worse). Score and letters won fell in all six.

Per-key correlation of avg place with each multiplier across the 6 candidates
(6 points for 12 keys: directional only, not significant; negative = raising it helped):
```
v_e +0.11  v_m +0.88  v_l -0.16 | c1_e +0.50  c1_m +0.39  c1_l +0.63
c24_e +0.28  c24_m +0.11  c24_l -0.08 | c5_e -0.33  c5_m +0.43  c5_l -0.39
```

**Learned table** = elite-3 mean (cands 5, 2, 1; what the CEM would have adopted
after gen 0):
```
{"v_e":0.995,"v_m":0.956,"v_l":1.089,"c1_e":0.989,"c1_m":1.096,"c1_l":1.025,"c24_e":1.067,"c24_m":1.123,"c24_l":0.962,"c5_e":1.24,"c5_m":1.035,"c5_l":1.14}

              early(>45)  mid(15-45)  late(<15)
vowels          1.00        0.96        1.09
1-pt cons       0.99        1.10        1.03
2-4 pt          1.07        1.12        0.96
5+ pt           1.24        1.04        1.14
```

**Out-of-sample confirmation of that table** (REPLAY_SEEDS=4; test = REPLAY_FILE=./replay_hack.json
REPLAY_SPLIT=test; strong = REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600
REPLAY_REAL=1, 97 matches), launched 02:57 UTC under load ~100:
```
test seed 11: policy:./variants/group-phase-multipliers/policy.ts {"v_e":0.995,"v_m":0.956,"v_l":1.089,"c1_e":0.989,"c1_m":1.096,"c1_l":1.025,"c24_e":1.067,"c24_m":1.123,"c24_l":0.962,"c5_e":1.24,"c5_m":1.035,"c5_l":1.14} n=232: avg place 2.23 score 87.2 win 0.38 letters 12.6 endbal 20 places[1..7]=87,72,32,24,9,7,1 (1284ms/match)
test seed 23: policy:./variants/group-phase-multipliers/policy.ts {"v_e":0.995,"v_m":0.956,"v_l":1.089,"c1_e":0.989,"c1_m":1.096,"c1_l":1.025,"c24_e":1.067,"c24_m":1.123,"c24_l":0.962,"c5_e":1.24,"c5_m":1.035,"c5_l":1.14} n=232: avg place 2.12 score 88.5 win 0.43 letters 12.7 endbal 21 places[1..7]=99,53,48,22,7,2,1 (1269ms/match)
strong pool:  policy:./variants/group-phase-multipliers/policy.ts {"v_e":0.995,"v_m":0.956,"v_l":1.089,"c1_e":0.989,"c1_m":1.096,"c1_l":1.025,"c24_e":1.067,"c24_m":1.123,"c24_l":0.962,"c5_e":1.24,"c5_m":1.035,"c5_l":1.14} n=388: avg place 2.17 score 98.6 win 0.34 letters 14.4 endbal 18 places[1..7]=133,141,55,38,17,3,1 (880ms/match)
```

## 4. Best configuration vs baselines
| pool | baseline v1 | elite-3 mean table |
|---|---|---|
| train seed 5 (REPLAY_SEEDS=2) | 1.99 | not evaluated as a table; its 3 components scored 2.05 / 2.08 / 2.19 |
| test seed 11 (REPLAY_SEEDS=4) | 2.09 (score 89.9, letters 12.8) | **2.23** (score 87.2, letters 12.6) -> -0.14 |
| test seed 23 (REPLAY_SEEDS=4) | 2.08 (score 90.0, letters 12.9) | **2.12** (score 88.5, letters 12.7) -> -0.04 |
| strong pool (97 x 4) | 2.07 (score 99.8, letters 14.7) | **2.17** (score 98.6, letters 14.4) -> -0.10 |

## 5. Verdict
**LOSS.** The learned table is worse than v1 on every pool: -0.14 on test seed 11,
-0.04 on test seed 23 (within noise), -0.10 on the strong pool, with lower score and
fewer letters won everywhere (SE ~0.08). It also never beat v1 on the train split it
was fitted on (best candidate 2.05 vs 1.99). Do not ship. The negative result is
clean: the identity check proves the only change is the table, and the table loses.

What the data says about where v1 over/under-bids (weak evidence, 6 noisy points):
- Nothing beat v1. The all-1.0 table was the best of 7 evaluated points on train. At
  the +-15% scale, v1's kappa x cash x ramp bid looks like a (noisy) local optimum
  with respect to group x phase reweighting; the two candidates within noise of it
  (2.05, 2.08) were the ones closest to 1.0 on the vowel and 1-point-consonant rows.
- Mid-game vowels and late 1-point consonants are the clearest "do not raise" cells
  (r = +0.88 and +0.63): both candidates with v_m >= 1.04 were the two worst.
- Premium letters: raising early (c5_e, r = -0.33) and late (c5_l, r = -0.39) 5+ point
  bids weakly helped relative to the other perturbations, raising mid-game premium bids
  hurt (c5_m +0.43; cand 4 with c5_m 1.45 -> 2.21). The search's direction therefore
  agrees with the leader gap (46% vs 19% early premium win rate) in sign, but the best
  candidate carrying c5_e 1.24 still did not beat the baseline on train, consistent with
  the brief's finding that blind premium boosts (x1.3/1.6/2.0) lose: in this design a
  higher c5 entry buys more K/J/X/Q/Z early only by paying above the market median, and
  the rack-value engine does not convert them into the 7-letter words the leaders make.
- Generalization: not demonstrated. With one partial generation the table is mostly
  noise around 1.0 (largest deviation 1.24), and it was never shown to beat v1 even on
  the pool it was fitted on, so a test/strong-pool gain would itself be suspect.

## 6. Risks
- Compute: identical to v1 by construction (one 4x3 array lookup added to `bid()`);
  replay reports ~130 ms per whole match (~68 bids + words calls) for v1 unloaded
  (BASELINES.txt), i.e. ~2 ms per decision on typical racks; the 28-tile-rack cost is
  v1's (budget 3000 partition nodes), unchanged. Not re-timed on a 28-tile rack tonight.
- Live data: uses only `rack`, `balance`, `bagLeft`, `maxRivalBalance`, `unseen`
  (same as v1) plus `market.json`, which v1 already reads. No archive lookups.
- Phase boundaries use `bagLeft` thresholds (45/15) tuned on 68-auction 6-seat
  matches; in the 88-auction heads-up final the "early" phase lasts 43 auctions and the
  table was never fitted there. The replay arena has no reacting rivals, so an entry
  > 1 that wins more premium letters in replay may only raise prices live.
- The fit is compute-starved: 6 candidates x 118 ghost runs (SE ~0.11) for 12 free
  parameters. A proper fit needs ~40 evals at REPLAY_SEEDS=4 on an idle box (~1 h).

## 7. How to enable
Not recommended (see verdict). If wanted anyway: in `src/strategy.ts` `Brain.bid()`,
after `let amt = gain * p.kappa * cash * ramp;` insert
`amt *= M[groupOf(letter)][phaseOf(v.bagLeft)];` with `groupOf/phaseOf` and the
table `M` from `src/variants/group-phase-multipliers/policy.ts` (values in section 3).
Replay: `REPLAY_POLICY=./variants/group-phase-multipliers/policy.ts ... src/replay.ts x 200 11 '<table json>'`.
To continue the search on an idle box: `REPLAY_FILE=./replay_hack.json REPLAY_SPLIT=train
REPLAY_SEEDS=2 ./node_modules/.bin/tsx src/variants/group-phase-multipliers/cem.ts 4 10 3`,
then `bash src/variants/group-phase-multipliers/confirm.sh '<FINAL mean json>' <tag>`.
