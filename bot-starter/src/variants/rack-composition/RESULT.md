# rack-composition: dictionary-measured "completability" instead of hand-set hoard rules

## 1. Idea and mechanism
v1's hoard() values kept tiles with hand-set rules (face x alpha x FRIEND, flat base, duplicate cap,
42%-vowel target). This variant measures the rack's future directly from the dictionary:
`mass(rack) = sum over 7..8-letter anagram classes k within <= 2 missing tiles of rack of
rew[k] * prod_{missing letter m} cQ * avail(m)`, where `avail(m) = 1 - (1 - unseen[m]/98)^min(bagLeft,30)`
(a missing letter only counts while it is still unseen) and cQ = 0.3 is the chance we win it.
`C = cw * log1p(mass)` (cMode 0) or `cw * sqrt(mass)` (cMode 1). One scan of the ~55k long classes per
auction yields both mass(rack+L) and mass(rack) (classes using the new L are "one more tile missing"
without it), so gain(L) = v1 partition gain (hoard scaled by `hoardMult`) + (1-beta) * (C(rack+L) - C(rack)).
kappa, cash factor, market floor, late fill, minBid, all-in and cap are v1's, untouched.

## 2. Files created
- `src/variants/rack-composition/policy.ts` — `CBrain extends Brain` (overrides `hoard` with `hoardMult`,
  adds `completability()`, copies v1 `bid()` with the dC term inserted), `makePolicy`.
- `src/variants/rack-composition/timing.ts` — timing/calibration script (bid ms/call, dC per letter).
- `src/variants/rack-composition/RESULT.md` — this report.

## 3. Evaluations run
All with `REPLAY_FILE=./replay_hack.json REPLAY_SEEDS=4 REPLAY_POLICY=./variants/rack-composition/policy.ts
.../tsx src/replay.ts x 200 <seed> '<config>'` unless noted. Train = tuning, test = reporting.

Pure replacement of the hoard (hoardMult 0, completability as the only hold value), train, seed 11:
```
policy:./variants/rack-composition/policy.ts {"cw":1,"cMode":1,"hoardMult":0} n=236: avg place 4.22 score 61.2 win 0.02 letters 8.8 endbal 30 places[1..7]=5,21,43,71,52,32,12 (691ms/match)
```
-> catastrophic (v1 is ~2.1 on this split): without the flat per-tile base the marginal value of most
letters is ~0, the bot buys 8.8 letters/match instead of ~13 and dies with 30 coins. The hand-set
"every tile is a future word slot" base is doing real work that a near-complete-bingo count does not replace.

Two additive runs with the pre-fix code (cw 4 and cw 8, log mode, cZero 0) were aborted unfinished to
free CPU after the consistency bug was found (the machine was at load 110 on 4 cores).

Sanity / train baseline (completability off = v1 pipeline through this wrapper), train, seed 11:
```
policy:./variants/rack-composition/policy.ts {"cw":0} n=236: avg place 2.13 score 91.9 win 0.43 letters 13.2 endbal 21 places[1..7]=102,67,29,19,12,5,2 (2109ms/match)
```
(ms/match is wall time on the shared machine at load ~110; v1 measures 128 ms/match idle.)

Additive candidates (hoard kept, completability added), all launched 02:38-02:46 UTC on a machine at
load 110-114 (4 cores, ~12 agents replaying), each taking 15-20 min; every line below is the verbatim
replay output except the strong-pool run, which was deliberately aborted (see below):
- train seed 11 `{"cw":0.7,"cMode":1}` (sqrt mode):
  ```
  policy:./variants/rack-composition/policy.ts {"cw":0.7,"cMode":1} n=236: avg place 3.78 score 67.5 win 0.07 letters 11.1 endbal 17 places[1..7]=17,27,53,70,40,21,8 (4904ms/match)
  ```
  -> clear loss (-1.65 vs 2.13). In sqrt mode dC is 2-6 points for almost every letter at every rack
  size (adding any tile opens more near-complete 7/8s), on top of hoard gains of ~4-8, i.e. a +50-100%
  bid inflation on everything rather than a re-ranking of letters. Fewer letters (11.1), cash-starved.
- train seed 11 `{"cw":4,"cZero":1}` (log mode, complete classes counted):
  ```
  policy:./variants/rack-composition/policy.ts {"cw":4,"cZero":1} n=236: avg place 3.25 score 74.5 win 0.10 letters 12.0 endbal 17 places[1..7]=23,49,71,54,19,18,2 (4781ms/match)
  ```
  -> clear loss (-1.12 vs the 2.13 train baseline). Log mode gives dC of 3-8 points on a 5-tile rack
  (doubling early bids) and ~0 on 20+ tiles, so the bot overpays early, is cash-starved mid-match and
  buys fewer letters (12.0 vs 13.2) while ending poorer (17 vs 21). Consistent with tonight's earlier
  finding that early bid inflation of any kind is harmful.
- test seed 11 `{"cw":0.7,"cMode":1}`:
  ```
  policy:./variants/rack-composition/policy.ts {"cw":0.7,"cMode":1} n=232: avg place 3.78 score 68.4 win 0.09 letters 11.1 endbal 17 places[1..7]=20,33,43,56,46,31,3 (3910ms/match)
  ```
  -> -1.69 vs the v1 test-11 baseline 2.09 (identical picture to train: 11.1 letters, 17 coins left).
- test seed 23 `{"cw":0.7,"cMode":1}`:
  ```
  policy:./variants/rack-composition/policy.ts {"cw":0.7,"cMode":1} n=232: avg place 3.70 score 68.4 win 0.08 letters 11.0 endbal 18 places[1..7]=19,35,48,56,46,24,4 (3975ms/match)
  ```
  -> -1.62 vs the v1 test-23 baseline 2.08.
- strong pool (`REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1`, x 97 11)
  `{"cw":0.7,"cMode":1}`: ABORTED at 02:59 UTC after the train line came in. With 388 runs it
  was projected to finish after the 03:15 stop, and a 1.65-place train deficit cannot be rescued by
  the strong pool (the brief's strong-pool check only gates WIN calls), so it was killed to free CPU
  for the other agents. No strong-pool number for this variant.

Note on method: because of the load, the test/strong runs for the sqrt candidate had to be launched
before its train line was in (there was no time to sequence train -> test); the candidate was chosen
from the calibration output (sqrt keeps dC O(1) across rack sizes, log saturates), not from train.

## 4. Best configuration vs baselines
| | test seed 11 | test seed 23 | strong pool |
|---|---|---|---|
| v1 baseline (BASELINES.txt) | 2.09 | 2.08 | 2.07 |
| `{"cw":0.7,"cMode":1}` (train 3.78 vs 2.13) | 3.78 (-1.69) | 3.70 (-1.62) | not run to completion (aborted, see 3.) |

There is no configuration to recommend: the best tested form is still 1.1 places behind v1 on train.

## 5. Verdict
**LOSS**, on every form tested, by large margins on the train split (seed 11, n=236, baseline 2.13):
- pure replacement of hoard by completability (`hoardMult 0, cw 1 sqrt`): 4.22 (-2.09)
- additive, log mode (`cw 4, cZero 1`): 3.25 (-1.12)
- additive, sqrt mode (`cw 0.7`): 3.78 (-1.65)
Out-of-sample (test 11/23, strong) numbers for the sqrt candidate are in the table above where they
finished; they can only confirm the loss (a train deficit of 1.65 places is ~20 standard errors).

Why it fails (mechanism, not noise): the completability of a rack is monotone in the rack, and the
marginal dC of *any* added tile is positive (more tiles -> more 7/8-letter classes within 2 missing),
so as an additive term it is mostly a uniform multiplier on bids, which the earlier kappa 3-4 and
early-floor experiments already showed is harmful; the letter-to-letter *ranking* it induces (C/M/P/H/B/Y
up, duplicates/vowels down on a balanced rack) is swamped by the level shift. Removing the hoard
instead removes the flat "every tile is a future word slot" base, and the bot stops buying (8.8
letters/match). What was NOT tested for lack of time (each 236-run eval took 15-20 min at load 110):
a spend-neutral form, e.g. `gain *= 1 + c * (dC - mean_L dC) / sd_L dC` or cw <= 0.15 in sqrt mode with
kappa lowered to hold total spend constant, and `hoardMult 0.5` with a small cw. If anyone revisits
the idea, that is the only form with a chance; the raw additive/replacement forms are dead.

## 6. Risks
- Compute: the completability scan is 1.1 ms (5 tiles), 3.2 ms (12), 3.3 ms (20), 4.1 ms (28 tiles) per
  bid() call on an idle core (uncontended measurement, `timing.ts`); the v1 partition search dominates
  (2.6 / 24 / 39 / 98 ms per call on 5/12/20/28 tiles). So the variant adds ~4% to decision time;
  the 28-tile case is already at v1's cost (~100 ms, inside the 150 ms budget, but no headroom to add more).
  Under tonight's shared load (load avg 30 on 4 cores) the same calls measured 4-5x slower, which is a
  machine-contention effect, not the policy's.
- Live data: uses only `State.rack`, `balance`, `bagLeft`, `unseen`, `maxRivalBalance`, `firstPrice`
  (all available live). No archive/future data. If `unseen` is missing the term is skipped (plain v1).
- Scale drift: `log1p(mass)` saturates on 20+ tile racks (dC -> ~0), so in log mode the term mostly
  changes early-game bids; `sqrt` mode keeps dC O(1) across rack sizes. Neither is normalised per
  tile, so the effective weight depends on rack size.
- Heads-up (88 auctions, 2 players): `draws = min(bagLeft, 30)` and `/98` are bag-based, so the
  availability model is the same; untested in a 2-seat replay tonight.
- A class that becomes complete with L is gated by `cZero` on both the with-L and without-L side
  (an earlier version counted it only on the without-L side and biased dC negative for exactly the
  letters that complete a bingo).

## 7. How to enable
Replay: `REPLAY_POLICY=./variants/rack-composition/policy.ts ... '{"cw":<w>,"cMode":<0|1>,...}'`.
Live: make `Brain.bid` in `src/strategy.ts` take the dC term as in `CBrain.bid` here (insert
`gain += (1 - beta(after)) * (C(rack+L) - C(rack))` after the partition gain, with `completability()`
copied into `Brain`), and add the `cw/cMode/cQ/cMaxMiss/cMinLen/cMaxLen/cZero/cFade/hoardMult` params
to `Params`/`DEFAULT_PARAMS`. `cw: 0` reproduces v1 exactly.
