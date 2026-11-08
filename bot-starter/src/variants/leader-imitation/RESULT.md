# leader-imitation — RESULT

## 1. Idea and mechanism
Learn the four leaders' (Lbender 201, RackMaw 193, LexForge-1107 207, GodOfThudner 171; ids verified in
`bots2.jsonl`) actual winning bids from the archive and imitate them where our own valuation agrees.
From 659 archived matches (365 leader seats, `x_*`+`w_*` JSONL, plays from `x_wp`/`y_wp`/`z_wp`) I built a
table of their winning sealed bids (`*_tb` top_bid) by letter x phase (early/mid/late thirds of the
auction index) x whether they already visibly held the letter (visible rack = letters won minus letters
in their plays; the 5 start tiles are hidden), with win rate per cell and q50/q60/q75/q90.
Bidder: v1 brain unchanged, but when v1's marginal gain >= `liMinGain` the bid is raised to at least the
leaders' cell quantile (`liQ`: 0=q50, 1=q60, 2=q75), optionally capped at their p90 (`liCap`).
Purchase mix (share of letters by group x phase) of leaders vs everyone else was also measured.

## 2. Files (all in `src/variants/leader-imitation/`)
- `analyze_leaders.py` — builds the table from the scratchpad JSONL (`python3 -I analyze_leaders.py <scratchpad> leaders.json`).
- `leaders.json` (full table incl. win rates, sources, purchase mix), `leaders_q.json` (compact `Q[letter][phase][hold] = [q50,q60,q75,q90]` read by the policy), `analysis.txt` (printed table).
- `policy.ts` — the policy (v1 + leader floor; `liQ:-1` reproduces v1 exactly; LI_STATS=1 prints our purchase mix at exit).
- `timing.ts` — CPU timing of `bid()` on 7/14/20/28-tile racks + v1-equivalence check.
- `runs/*.txt` — raw replay outputs.

## 3. What the table says (leaders' winning sealed bids, q50 / q75; win rate = their wins / auctions of that letter they sat in)
| letter | early q50/q75 (win%) | mid q50/q75 (win%) | late q50/q75 (win%) | market.json medTop (v1 floor) early..late |
|---|---|---|---|---|
| Z | 54 / 58.5 (47%) | 49 / 54 (40%) | 36.5 / 39.5 (28%) | 40,40,36,34,30 |
| Q | 41 / 47.5 (32%) | 34 / 44 (33%) | 26 / 31 (24%) | |
| X | 39.5 / 44 (45%) | 35.5 / 41 (32%) | 33 / 38 (26%) | |
| J | 37 / 40 (47%) | 36 / 41 (27%) | 32 / 38 (23%) | |
| K | 27 / 28 (31%) | 26 / 28 (33%) | 24 / 30.5 (22%) | |
| E (not held) | 12 / 14 (12%) | 13 / 15 (25%) | 15 / 18 (27%) | |
| E (held) | 11.5 / 12 (13%) | 11 / 14 (10%) | 12 / 18 (14%) | |
| A / R / S (not held) | 11-13 / 14-15 (9-13%) | 13-14 / 15-16 (21-25%) | 15-15.5 / 19-21 (21-22%) | |
Holding a letter already: leaders win it 2-3x less often and bid 1-2 coins less (they avoid duplicates);
premium letters are essentially never bought when already held (0 of ~1,400 premium auctions).
Purchase mix (share of letters won) leaders vs everyone else:
- early: vowel 35% / cons1 16% / cons2-4 37% / prem5+ 12%   vs   43% / 28% / 25% / 4%
- mid:   40% / 23% / 29% / 8%                                  vs   43% / 27% / 26% / 5%
- late:  42% / 25% / 27% / 6%                                  vs   43% / 27% / 25% / 5%
So the leaders' fingerprint is: buy premium and 2-4 point consonants EARLY (12% + 37% of early purchases),
at prices 10-35% above the market median, then fade to the field's mix. Our v1 mix (LI_STATS from the train reference run, 236 replays): early 29.5% / 20% / 43% / 7.7%, mid 38% / 24% / 31% / 6.7%, late 44.5% / 26.5% / 26% / 3.1%.
So v1 is ALREADY closer to the leaders' mix than the field is (more 2-4pt consonants and fewer vowels early); the only
mix gap is early premium share (7.7% vs 12.3%) and late premium (3.1% vs 6.2%) -- i.e. exactly the letters the leader floor
buys, and buying them at leader prices loses (below). The leaders' edge is conversion (7s built around the premium tile,
played mid-match), not the shopping list, so a mix nudge was not pursued further.

## 4. Evaluations (verbatim output lines; `REPLAY_FILE=./replay_hack.json REPLAY_SEEDS=4 REPLAY_POLICY=./variants/leader-imitation/policy.ts ... src/replay.ts x 200 <seed> <json>`)
Machine note: ~200 replay processes from other agents were running (load average 90-115), so every run took
15-20 min wall-clock; the ms/match figures below are inflated ~25x and say nothing about the policy.

train split, seed 11:
- `{"liQ":0}` (floor = leaders' q50): `policy:./variants/leader-imitation/policy.ts {"liQ":0} n=236: avg place 2.43 score 85.4 win 0.28 letters 13.2 endbal 18 places[1..7]=66,69,58,28,8,6,1 (3156ms/match)`
- `{"liQ":2}` (floor = leaders' q75): `policy:./variants/leader-imitation/policy.ts {"liQ":2} n=236: avg place 3.07 score 76.2 win 0.15 letters 12.3 endbal 18 places[1..7]=36,48,69,48,18,16,1 (3434ms/match)`
- `{"liQ":-1}` (= v1, reference; LI_STATS=1): `policy:./variants/leader-imitation/policy.ts {"liQ":-1} n=236: avg place 2.13 score 91.9 win 0.43 letters 13.2 endbal 21 places[1..7]=102,67,29,19,12,5,2 (4439ms/match)`
  -> q50 floor = -0.30 places, q75 floor = -0.94 places vs v1 on the same split/seed (SE ~0.08): monotone degradation.
- `{"liQ":1}` (q60) on train: failed to launch (shell env bug, see runs/tr11_q60.txt); run on test instead.

test split (reporting), seeds 11 and 23:
- seed 11 `{"liQ":0}`: `policy:./variants/leader-imitation/policy.ts {"liQ":0} n=232: avg place 2.64 score 82.1 win 0.23 letters 12.7 endbal 19 places[1..7]=54,69,46,41,13,9,0 (4573ms/match)`
- seed 23 `{"liQ":0}`: `policy:./variants/leader-imitation/policy.ts {"liQ":0} n=232: avg place 2.38 score 84.6 win 0.33 letters 12.9 endbal 19 places[1..7]=76,65,45,26,14,6,0 (4567ms/match)`
- seed 11 `{"liQ":1}`: `policy:./variants/leader-imitation/policy.ts {"liQ":1} n=232: avg place 2.81 score 79.7 win 0.20 letters 12.6 endbal 19 places[1..7]=47,66,49,39,18,12,1 (4612ms/match)`
- seed 23 `{"liQ":1}`: `policy:./variants/leader-imitation/policy.ts {"liQ":1} n=232: avg place 2.62 score 81.4 win 0.27 letters 12.9 endbal 19 places[1..7]=63,56,48,46,11,7,1 (4623ms/match)`
- seed 11 `{"liQ":2}`: `policy:./variants/leader-imitation/policy.ts {"liQ":2} n=232: avg place 3.08 score 76.1 win 0.16 letters 12.2 endbal 18 places[1..7]=37,49,62,46,18,20,0 (4639ms/match)`
- seed 23 `{"liQ":2}`: `policy:./variants/leader-imitation/policy.ts {"liQ":2} n=232: avg place 2.97 score 76.9 win 0.19 letters 12.3 endbal 20 places[1..7]=44,57,46,47,26,10,2 (4628ms/match)`
- Mechanism (LI_STATS of the q50 test runs vs the v1 reference): early purchases per 232 replays 1366 (v1: 687 per 236),
  early premium share 4.8% (v1 7.7%), late purchases 703 (v1 1100). The leaders' q50 for A/E/I/O/R/N/T early (12-13) is above
  v1's gain-based bid, so the floor binds on cheap common letters, front-loads the spend, and we then cannot afford the
  premium letters or the late fill. Imitating the leaders' prices without their rack/conversion makes us buy the wrong tiles.

strong pool (`REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1 REPLAY_SEEDS=4 ... x 97 11`):
- `{"liQ":0}`: `policy:./variants/leader-imitation/policy.ts {"liQ":0} n=388: avg place 2.49 score 90.9 win 0.23 letters 14.3 endbal 17 places[1..7]=90,126,90,58,23,1,0 (2839ms/match)`
- `{"liQ":1}`: `policy:./variants/leader-imitation/policy.ts {"liQ":1} n=388: avg place 2.77 score 87.7 win 0.20 letters 14.0 endbal 17 places[1..7]=77,102,99,63,41,4,2 (2869ms/match)`
  (v1 baseline on this pool: 2.07, score 99.8, letters 14.7, endbal 19 -> -0.42 and -0.70 places.)

Not run for lack of time (machine saturated): the gain-threshold sweep (`liMinGain` 4/6), the p90 cap
(`liCap`), the premium-only quantile (`liQPrem`) and the mix nudge. Given the monotone degradation
q50 -> q75 they are unlikely to turn this into a win, but `liMinGain:6` + `liCap:1` is the one untested
combination that could plausibly be neutral.

## 5. Best configuration vs baselines
| config | train s11 | test s11 | test s23 | strong |
|---|---|---|---|---|
| v1 baseline (BASELINES.txt; train = this harness, liQ:-1) | 2.13 | 2.09 | 2.08 | 2.07 |
| leader floor q50 `{"liQ":0}` (least bad) | 2.43 | 2.64 | 2.38 | 2.49 |
| leader floor q60 `{"liQ":1}` | - | 2.81 | 2.62 | 2.77 |
| leader floor q75 `{"liQ":2}` | 3.07 | 3.08 | 2.97 | - |
Best (least bad) configuration: q50 floor, min gain 2: -0.55 (test seed 11), -0.30 (test seed 23), -0.42 (strong pool) places vs v1.

## 6. Verdict
**LOSS.** Every quantile loses on both test seeds, monotonically with the quantile: q50 -0.55/-0.30, q60 -0.72/-0.54,
q75 -0.99/-0.89 places (SE ~0.08); strong pool q50 -0.42, q60 -0.70. Also -0.30 on train. Direct imitation of the leaders' winning prices is not the edge;
the reusable outputs are the table itself (`leaders.json`: their premium prices fall ~35% from early to late, they never
buy a premium letter they already hold, holding a letter halves their win rate on it) and the purchase-mix comparison
(v1's mix already matches the leaders' except for early premium share).

## 7. Risks
- Compute: `bid()` on a 28-tile rack = ~65 ms CPU (v1's own cost; the leader floor is a table lookup). The
  first version computed the partition search twice (131 ms CPU on 28 tiles); fixed by reusing the gain
  (`v1Tail` is a verbatim copy of `Brain.bid`'s tail). Wall-clock on the loaded box was ~1 s, which is
  the box, not the policy. Measured (runs/timing.txt): `v1 equivalence (liQ:-1 vs Brain.bid): 416/416 identical`; `28 tiles: bid 286ms wall / 60ms cpu; words 166ms wall / 33ms cpu`; 20 tiles 43 ms cpu, 14 tiles 33 ms cpu, 7 tiles 2 ms cpu.
- Live availability: everything is a static JSON table shipped with the policy (`leaders_q.json`,
  `market.json`); nothing is read from the match record or future auctions. Phase uses
  `auctionIndex`/`totalAuctions` (falls back to `bagLeft`), so it scales to the 88-auction heads-up final.
- Heads-up: the leaders' table is from 6-seat tables; in a 2-player match their prices (one rival only,
  more free tiles) are meaningless and the floor would overpay. Would need `liQ:-1` for heads-up.
- The mechanism itself is the risk: paying leader prices for premium letters without the leaders'
  conversion (they build 7s around the Z/Q/X/J and play them mid-match) just drains cash — consistent with
  tonight's earlier negatives (premium multipliers x1.3-2.0 monotonically worse).

## 8. How to enable
Not recommended. If wanted anyway: `REPLAY_POLICY=./variants/leader-imitation/policy.ts` with
`{"liQ":0}` (q50 floor; `liMinGain`, `liCap`, `liQPrem`, `liHold`, `liMarket`, `liScale`, `liAfford`
are the other knobs). To port into `strategy.ts`: load `leaders_q.json` as `Q` and, after the market-floor
block in `Brain.bid`, add `if (gain >= liMinGain) amt = max(amt, Q[letter][phase][rack[letter]>0?1:0][qi])`.
The table-building script and the purchase-mix numbers above are reusable regardless of the verdict.
