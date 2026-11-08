# opponent-aware: bid against the five bots actually seated

## 1. Idea and mechanism

v1's bid is kept intact; only the floor / denial / sniping layer is re-decided against the
seated rivals (`State.rivals` balances, `State.rivalScores`, fitted per-bot models from
`src/bots.json` via `Brain2.rivalModel` / `maxRivalCdf`, generic model when a bot is unmodeled):

- (a) `rivalFloorQ`: v1 lifts any bid with marginal value >= 2 to the archive median winning bid
  (letter x phase, all tables). Here the floor becomes a quantile of the composed max-rival-bid
  distribution (product of the seated rivals' LogNormal CDFs, each truncated at its live
  balance, times an optional online heat from clearing prices). Theory note: in a Vickrey
  auction the EV-maximising bid under ANY rival distribution is the truthful value/lambda
  (every price x < v/lambda has positive surplus, every x above has negative), so
  "argmax_b P(win|b) x (v - lambda E[pay|win])" collapses to v1's kappa scaling; the rival
  distribution can only change the floor layer and pacing, not the core bid. No runs needed.
- (b) `denialN`: when a rival within `denialBand` (15) points of our score can still bid above
  us, add `denialN` x P(that rival bids >= our bid) coins (their fitted/generic model), so a
  contender pays more or we take the tile. Off in the last `denialUntil` (16) auctions.
- (c) `snipeBelow`: when the richest rival's balance <= `snipeBelow`, bid the cap
  (richest rival balance + 1) on any letter with marginal value >= `snipeMinGain`: nobody can
  outbid us and leftover cash is worth 0.

Two data facts found while building (archive analysis, not used by the policy):
- In `replay_hack.json` (HackUTD pool = tune/test pool, the tournament-like field) **0 of 702
  seats** have a fitted model in `bots.json` (46 distinct bot ids, none modeled), so there
  every rival is the GENERIC seat and the "per-bot" part of (a)/(b) degenerates to the market
  model + balance truncation. The strong pool (`replay_data.json`) is 83% modeled (Bron,
  LUCENT, maverick-bot, house sims).
- Replaying the recorded balances (100 - paid + word rewards per bot) over all 117 HackUTD
  matches: in **0 of 7,722** auctions with >= 2 auctions left is the richest rival's balance
  <= 12 (<= 6: 0; <= 25: 11 auctions = 0.1%; never in the last 16 auctions). At a 6-seat
  table at least one rival always keeps > 12 coins, so (c) `snipeBelow: 12` can never fire
  and is v1 by construction; `snipeBelow: 25` fires on ~0.1% of auctions. Sniping is a
  heads-up-only mechanism (final: 2 seats, 88 auctions).

## 2. Files created (all in `src/variants/opponent-aware/`)

- `brain.ts`: copy of `src/strategy.ts` (imports re-pointed) with `bid()` split into
  `bidParts()` exposing `gain`, `cap`, `pre` (amount before floor/minBid), `floor`, `special`.
  Bids are bit-identical to v1 (verified: same 20-match line as `v1`).
- `policy.ts`: `makePolicy(d, over, rnd)`; params `rivalFloorQ, rivalFloorW, heat0,
  heatWeight, denialN, denialBand, denialMinGain, denialMinFace, denialUntil, snipeBelow,
  snipeMinGain` (all off by default = exact v1) plus any v1 `Params`.
- `RESULT.md` (this file).

## 3. Evaluations run

All with `REPLAY_FILE=./replay_hack.json REPLAY_SEEDS=4 REPLAY_POLICY=./variants/opponent-aware/policy.ts
tsx src/replay.ts x 200 <seed> '<json>'` unless marked strong
(`REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1 ... x 97 11`).
The machine was shared by ~12 agents (load average 108-110, 110 concurrent replay processes),
so a 236-run eval took ~15-20 min of wall clock instead of 1-3; strong-pool runs were cut to
`REPLAY_SEEDS=2` (194 runs) to fit the deadline.

Sanity (train, REPLAY_SEEDS=1, n=20): variant `{}` = `avg place 2.40 score 88.5 win 0.30 letters 12.8 endbal 21`
== `v1 {}` identical line.

Launched (all REPLAY_SEEDS=4, n=200 -> 236 runs on the 59-match split; strong = 97 matches x 2 seeds):

| tag | split/seed | config | replay output line |
|---|---|---|---|
| base | train 11 | `{}` | `policy:./variants/opponent-aware/policy.ts {} n=236: avg place 2.13 score 91.9 win 0.43 letters 13.2 endbal 21 places[1..7]=102,67,29,19,12,5,2 (5481ms/match)` |
| A1 | train 11 | `{"rivalFloorQ":0.5}` | `policy:./variants/opponent-aware/policy.ts {"rivalFloorQ":0.5} n=236: avg place 2.05 score 92.3 win 0.44 letters 13.3 endbal 20 places[1..7]=104,68,32,21,5,4,2 (5495ms/match)` |
| A2 | train 11 | `{"rivalFloorQ":0.5,"heatWeight":0.12}` | `policy:./variants/opponent-aware/policy.ts {"rivalFloorQ":0.5,"heatWeight":0.12} n=236: avg place 3.08 score 75.7 win 0.13 letters 12.0 endbal 20 places[1..7]=31,60,58,48,27,9,3 (5615ms/match)` |
| B1 | train 11 | `{"denialN":4}` | `policy:./variants/opponent-aware/policy.ts {"denialN":4} n=236: avg place 2.14 score 91.0 win 0.36 letters 13.2 endbal 20 places[1..7]=85,80,38,23,6,4,0 (5497ms/match)` |
| C1 | train 11 | `{"snipeBelow":12}` | killed: provably identical to v1 (condition never fires, see section 1) |
| C2 | train 11 | `{"snipeBelow":25}` | killed: fires on 0.1% of auctions, indistinguishable from v1 |
| A1 | test 11 | `{"rivalFloorQ":0.5}` | `policy:./variants/opponent-aware/policy.ts {"rivalFloorQ":0.5} n=232: avg place 2.05 score 89.7 win 0.41 letters 12.9 endbal 21 places[1..7]=96,71,38,17,4,6,0 (4107ms/match)` |
| A1 | test 23 | `{"rivalFloorQ":0.5}` | `policy:./variants/opponent-aware/policy.ts {"rivalFloorQ":0.5} n=232: avg place 2.12 score 89.7 win 0.43 letters 12.9 endbal 22 places[1..7]=99,63,35,19,11,5,0 (4111ms/match)` |
| B1 | test 11 | `{"denialN":4}` | `policy:./variants/opponent-aware/policy.ts {"denialN":4} n=232: avg place 2.17 score 88.6 win 0.38 letters 12.9 endbal 20 places[1..7]=87,74,36,21,7,7,0 (4101ms/match)` |
| B1 | test 23 | `{"denialN":4}` | `policy:./variants/opponent-aware/policy.ts {"denialN":4} n=232: avg place 2.07 score 90.1 win 0.41 letters 12.9 endbal 21 places[1..7]=95,70,38,18,7,4,0 (4098ms/match)` |
| ALL | test 11 | `{"rivalFloorQ":0.5,"denialN":4,"snipeBelow":12}` | `policy:./variants/opponent-aware/policy.ts {"rivalFloorQ":0.5,"denialN":4,"snipeBelow":12} n=232: avg place 2.17 score 88.6 win 0.37 letters 13.0 endbal 20 places[1..7]=86,76,32,27,5,6,0 (4109ms/match)` |
| ALL | test 23 | `{"rivalFloorQ":0.5,"denialN":4,"snipeBelow":12}` | `policy:./variants/opponent-aware/policy.ts {"rivalFloorQ":0.5,"denialN":4,"snipeBelow":12} n=232: avg place 2.08 score 89.5 win 0.43 letters 13.0 endbal 21 places[1..7]=99,64,39,18,7,4,1 (4107ms/match)` |
| ALL | strong seeds=2 | `{"rivalFloorQ":0.5,"denialN":4,"snipeBelow":12}` | `policy:./variants/opponent-aware/policy.ts {"rivalFloorQ":0.5,"denialN":4,"snipeBelow":12} n=194: avg place 2.22 score 96.9 win 0.34 letters 14.4 endbal 18 places[1..7]=65,67,32,16,13,1,0 (4820ms/match)` |
| A1 | strong seeds=2 | `{"rivalFloorQ":0.5}` | `policy:./variants/opponent-aware/policy.ts {"rivalFloorQ":0.5} n=194: avg place 2.14 score 99.3 win 0.38 letters 14.5 endbal 19 places[1..7]=73,65,28,14,12,2,0 (4819ms/match)` |

Test-split runs were launched in parallel with the train runs (not after them) because of the
load; selection is still by the train lines (A1 was the only train improver), and every
test/strong line is reported. The ms/match figures reflect the shared load, not the policy
(v1 itself ran at 128-138 ms/match on an idle core).

Reading: A2's online heat multiplies the composed distribution by the EMA of paid/medSecond
(clamped 0.3-3); clearing prices in these matches run far above the archive medSecond, so every
floor inflated and the bot overpaid on everything (score 75.7, win 0.13). Denial (B1) bought
nothing: +0.01 train, +0.08/-0.01 test, and ALL lost on the strong pool (2.22 vs 2.07) where
the fitted rival models actually have coverage.

## 4. Best configuration vs baselines

Best (selected on train): A1 = `{"rivalFloorQ":0.5}` (floor = median of the composed max-rival-bid
distribution truncated at live balances, fixed heat 1; denial and sniping off).

| | A1 `{"rivalFloorQ":0.5}` | v1 baseline | delta (negative = better) |
|---|---|---|---|
| train seed 11 (n=236) | 2.05 | 2.13 (same run setup) | -0.08 |
| test seed 11 (n=232) | 2.05 | 2.09 | -0.04 |
| test seed 23 (n=232) | 2.12 | 2.08 | +0.04 |
| strong pool (n=194, 2 seeds) | 2.14 | 2.07 (n=388, 4 seeds) | +0.07 |

Baselines (`src/variants/BASELINES.txt`): test seed 11 v1 2.09; test seed 23 v1 2.08;
strong pool v1 2.07 (388 runs).

## 5. Verdict

**NEUTRAL** (do not enable). A1 is within noise everywhere (-0.04 / +0.04 on the two test seeds,
+0.07 worse on the strong pool, SE ~0.08) and misses the >= 0.10-on-both-seeds bar. Denial is
NEUTRAL-to-LOSS (+0.08 / -0.01 test; the ALL combo is a LOSS on the strong pool, +0.15). Online
heat is a clear LOSS (+0.95 train). Sniping is a provable no-op at 6-seat tables.
Why the idea has no room: (1) under Vickrey the EV-optimal core bid is value/lambda whatever
the rival distribution, so only the floor layer could change; (2) the composed generic floor is
by construction ~the market median, and the one genuinely opponent-specific input at HackUTD
tables (balances) almost never binds (richest rival < 25 coins on 0.1% of auctions); (3) where
per-bot models exist (strong pool) they did not help either, echoing the v2 finding.

## 6. Risks

- Compute: on a 28-tile rack the whole decision costs mean 214 ms CPU / worst 306 ms
  (measured under the 110-process load); plain v1 on the same 104 decisions: mean 223 ms /
  worst 363 ms. The opponent layer itself is <= ~100 CDF evaluations (5 Phi each), i.e.
  well under 1 ms; all the cost is v1's existing `bestPartition(budget 3000)` and is
  unchanged from the live bot. On an idle core v1 runs 128-138 ms/match (~2 ms/decision).
- Live data: uses only `State.rivals`, `rivalScores`, `score`, `maxRivalBalance`, `bagLeft`,
  `totalAuctions`, and `bots.json`/`market.json` which ship with the client. No match record or
  future information. If `rivals` is missing the policy falls back to exact v1.
- Model coverage: tournament HackUTD bots are not in `bots.json`, so the per-bot models are
  inert against them (generic seat); only balance truncation, sniping and score-band denial
  are genuinely opponent-specific there. (b) relies on `rivalScores` being current.
- Arena bias for denial: the replay scores a lost-but-overbid auction as a drain of
  0.5 points per coin on the real winner, which may overstate the value of price-driving;
  a win forced by the +N coins is paid at the recorded top bid (real cost).
- Heads-up (2 seats, 88 auctions): sniping is strongest there (cap = opponent balance + 1 is
  cheap to hit once they are low); the denial band (15 points) is almost always satisfied
  heads-up, so `denialN` would fire on nearly every letter - keep it off or small for the
  final. `rivalFloorQ` with one rival uses that rival's own model if it is in `bots.json`.

## 7. How to enable

Point the live client at the variant brain or copy the layer into `src/strategy.ts`:
`REPLAY_POLICY=./variants/opponent-aware/policy.ts` with the JSON from section 4, or
import `makePolicy` from `src/variants/opponent-aware/policy.ts` in `src/index.ts` with
`over = <best config>`. All opponent params default to off, which is bit-identical v1.
