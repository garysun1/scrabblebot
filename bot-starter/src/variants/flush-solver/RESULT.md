# flush-solver — RESULT

## 1. Idea and mechanism
v1 scores "the flush" at bagLeft <= 1 with `bestPartition` (3000 nodes, the full candidate
list re-scanned at every node). Hypothesis: that budget leaves points on the table on 20-30
tile flush racks. The variant adds (a) `strongPartition`: branch-and-bound that filters the
candidate list per node (deep nodes become nearly free) with a tighter bound (face x
length-multiplier of the remaining rack, and floor(n/2) x best remaining reward), time-capped
at 250 ms, exact when it finishes; (b) instrumentation of the 3000-node vs strong gap on the
racks actually met at flush time in replay, plus where our points come from; (c) knobs for
flush timing (flushAt, preFlushAt/preFlushLen, playNowLen) and endgame bidding (exactGainAt,
strongBidAt); (d) `fastPartition`: the same objective and node budget as `bestPartition`
(hoard-aware) but with the cheap-node search and tighter bound, as a drop-in for all valuations.

## 2. Files
- `src/variants/flush-solver/policy.ts` — XBrain (extends v1 Brain), strongPartition, fastPartition, instrumentation, makePolicy.
- `src/variants/flush-solver/timing.ts` — quality/timing harness on random big racks.
- `src/variants/flush-solver/check.ts` — exactness check of strong/fast vs bestPartition on small racks.
- `src/variants/flush-solver/midgap.ts` — mid-match (hoard objective) plan gap between budgets.
- `src/variants/flush-solver/RESULT.md` — this report.

## 3. Evaluations (verbatim output lines)

### 3a. Solver quality/timing on synthetic racks (`tsx src/variants/flush-solver/timing.ts 28 16`, machine uncontended at the time)
```
tiles=28 racks=16: base avg 144.7 pts 56ms | strong avg 155.1 pts 101ms (max 265ms, cut 5/16) maxCands=19104
```
Per rack the 3000-node search costs 28-117 ms on 28 tiles (10k-19k candidates); the strong
solver finishes exactly in 0-34 ms on 11/16 racks and is cut at 250 ms on 5/16; it finds
+10.4 points per rack on average (max +38: 153 -> 191 JAYWALKED QUONDAM FURTIVE BUNTS; +31: 106 -> 137).
`timing.ts 26 8` (machine at load ~100, times inflated):
```
fast(3000, leftover 0) avg 149.6 pts 150ms | hoard state: base(3000) avg 143.1 115ms vs fast(3000) avg 144.0 76ms
tiles=26 racks=8: base avg 141.1 pts 100ms | strong avg 150.3 pts 214ms (max 325ms, cut 6/8) maxCands=12419
```
i.e. at the SAME 3000-node budget the filtered search scores +8.5 pts/rack with leftover 0.

Mid-match objective (reward + 0.5 x hoard, the state in which 92% of our points are actually
cashed, see 3b), `tsx src/variants/flush-solver/midgap.ts 10` (load ~110, times inflated):
```
tiles=16 racks=10: hoard objective base(3000) 86.4 47ms | fast(3000) 87.0 91ms | base(300k) 87.1 1741ms | plan differs 3000 vs 300k: 3/10
tiles=20 racks=10: hoard objective base(3000) 104.6 51ms | fast(3000) 104.8 14ms | base(300k) 106.0 2801ms | plan differs 3000 vs 300k: 4/10
```
So where it matters (12-20 tile racks with the hoard term) the 3000-node plan is within
~1 point of the 300k-node plan; the large flush gap above only exists on 26-28 tile racks
with no hoard term, which v1 never reaches (3b). Correctness: `check.ts 11 120`:
`leftover-0 mismatches 0; hoard-state differences 0` (strong/fast equal bestPartition when all complete).

### 3b. Instrumentation on the racks actually met at the flush (INSTRUMENT=1, play identical to v1)
test split seed 11, REPLAY_SEEDS=4, `{"solver":0}`:
```
policy:./variants/flush-solver/policy.ts {"solver":0} n=232: avg place 2.09 score 89.9 win 0.40 letters 12.8 endbal 21 places[1..7]=93,77,28,22,6,6,0 (554ms/match)
[flush-solver instrument] flush racks=9 (>=20 tiles: 0) avg tiles 8.7 | base(budget 3000) avg 31.4 pts 1.0 ms | strong avg 31.4 pts 2.0 ms 7 nodes incomplete 0 | gain avg 0.00 max 0 better 0 worse 0
```
(the variant reproduces the baseline line exactly, as required.) **Only 9 of 232 matches reach
the flush with >= 8 tiles, none with >= 20, and on those the 3000-node partition is already
optimal (gap 0).** Reason: the starvation rule (`balance < starveCash=20` -> cash 5+ letter
words) fires repeatedly in the last ~16 auctions (late fill >= 12, all-in), so v1 cashes most
of its words BEFORE the flush; the "flush" is a small leftover. The premise of the idea does
not hold for v1 as configured.
Where v1's points come from (same run, second instrumentation line, test seed 11, 232 matches):
```
[flush-solver instrument] matches=232 points: flush 1719 (8%) before flush 19145 (92%, of which starved-cash 19145); mid plays 503 avg bagLeft 19.7 | flush rack size hist (first flush call per match): 0:22 1:24 2:32 3:51 4:53 5:25 6:10 7:6 8:6 9:1 10:1 11:1
```
So 92% of our points are cashed by the starvation rule (balance < 20 -> play 5+ letter words),
on average with 19.7 auctions left — essentially the leaders' timing (brief: ~20 auctions
left) — and the flush (8% of points) sees a rack of <= 5 tiles in 207/232 matches. The
3000-node budget costs nothing at the flush; the thing to scrutinize instead is the plan
chosen at those starvation cash-outs (12-20 tile racks, hoard leftover), which is what the
`fastPlan` knob (same budget, cheaper nodes, tighter bound) addresses.

### 3c. Replay evaluations
All with `REPLAY_FILE=./replay_hack.json REPLAY_SEEDS=4 REPLAY_POLICY=./variants/flush-solver/policy.ts tsx src/replay.ts x 200 <seed> '<json>'`.
Note on process: the machine ran at load 80-115 on 4 cores all along (other agents' replays);
my first batch of 10 runs (test 11/23, strong pool, and 6 knob configs on train) was killed at
02:58 when its launcher hit the 20-minute background limit before any run finished, so the
knob configs were re-run directly on the test split (seed 11 only, no train tuning — they are
single untuned settings, reported as such). Seed 23 and strong-pool runs of `solver:1` did not
complete before the hard stop; since `solver:1` plays identically to v1 on every flush rack
met in the test split (gap 0 on 232 matches), its seed-23/strong lines are expected to equal the
baselines, but that is an inference, not a measurement.

- test seed 11 `{"solver":0}` (= v1 play, instrumentation on): `policy:./variants/flush-solver/policy.ts {"solver":0} n=232: avg place 2.09 score 89.9 win 0.40 letters 12.8 endbal 21 places[1..7]=93,77,28,22,6,6,0 (554ms/match)` (identical to the v1 baseline line)
- train seed 11 `{"solver":0,"fastPlan":1}` (fast search in ALL valuations, same 3000 budget): `policy:./variants/flush-solver/policy.ts {"solver":0,"fastPlan":1} n=236: avg place 2.13 score 91.9 win 0.43 letters 13.2 endbal 21 places[1..7]=102,67,29,19,12,5,2 (2170ms/match)` — its train reference (v1 on train) was in the killed batch; vs the TEST baseline 2.09/89.9 it is +0.04 place, +2.0 score: NEUTRAL (within noise).
- test seed 11 `{"solver":1,"playNowLen":8}` (play 8+ letter words immediately): `policy:./variants/flush-solver/policy.ts {"solver":1,"playNowLen":8} n=232: avg place 2.09 score 89.9 win 0.40 letters 12.9 endbal 21 places[1..7]=93,77,29,22,4,7,0 (1274ms/match)` — identical to baseline: NEUTRAL (8-letter words are rare enough that nothing changes).
- test seed 11 `{"solver":1}` (strong flush solver): `policy:./variants/flush-solver/policy.ts {"solver":1} n=232: avg place 2.09 score 89.9 win 0.40 letters 12.8 endbal 21 places[1..7]=93,77,28,22,6,6,0 (1302ms/match)` — identical to baseline, as the gap-0 instrumentation predicts.
- test seed 11 `{"solver":1,"flushAt":2}` (flush one auction earlier): `policy:./variants/flush-solver/policy.ts {"solver":1,"flushAt":2} n=232: avg place 2.14 score 89.3 win 0.40 letters 12.7 endbal 21 places[1..7]=93,71,30,25,6,7,0 (1294ms/match)` — -0.05 place, -0.6 pts: that is the replay cost (no latency in replay) of the safer flush; small but not free.
- test seed 11 `{"solver":1,"preFlushAt":3}` (play 7+ letter words from bagLeft <= 3 on): `policy:./variants/flush-solver/policy.ts {"solver":1,"preFlushAt":3} n=232: avg place 2.08 score 90.1 win 0.40 letters 12.8 endbal 21 places[1..7]=93,77,28,23,6,5,0 (1300ms/match)` — +0.01 place, +0.2 pts: free in replay, i.e. a zero-cost latency hedge for the long words (only tested on one seed).
- test seed 11 `{"solver":1,"exactGainAt":3}` (bid with beta=1 exact partition gain at bagLeft <= 3): `policy:./variants/flush-solver/policy.ts {"solver":1,"exactGainAt":3} n=232: avg place 2.09 score 89.9 win 0.40 letters 12.8 endbal 21 places[1..7]=93,77,27,23,6,6,0 (1296ms/match)` — identical: at bagLeft 2 the gain is already exact in v1 (beta(after=1)=1) and at bagLeft 3 the hoard weight is only 6%, so nothing changes. The all-in rule at bagLeft <= 1 was left as is (the tile is played at bagLeft 0 in replay and live, same words-before-bid order in index.ts).
- not completed before the hard stop (killed with the launcher at 02:58): `solver:1` on test seed 23 and on the strong pool; `strongBidAt:2`, `fastPlan` budget 20000, and the train-split copies of the knobs.

## 4. Best configuration vs baselines
| config | test seed 11 | test seed 23 | strong pool |
|---|---|---|---|
| v1 baseline | 2.09 / 89.9 | 2.08 / 90.0 | 2.07 / 99.8 |
| `{"solver":1}` (strong flush solver) | 2.09 / 89.9 | not run (killed) | not run (killed) |
| `{"solver":1,"flushAt":2}` | 2.14 / 89.3 | – | – |
| `{"solver":1,"preFlushAt":3}` | 2.08 / 90.1 | – | – |
| `{"solver":1,"exactGainAt":3}` | 2.09 / 89.9 | – | – |
| `{"solver":1,"playNowLen":8}` | 2.09 / 89.9 | – | – |
| `{"fastPlan":1}` (train seed 11) | 2.13 / 91.9 (train) | – | – |
No configuration beats the baseline by >= 0.10 on both test seeds; none was expected to once
the instrumentation showed the flush is empty.

## 5. Verdict
**NEUTRAL (negative result on the premise).** The 3000-node flush partition leaves 0 points on
the table in replay: v1 cashes 92% of its points before the flush via the starvation rule and
reaches the flush with <= 5 tiles in 89% of matches; the stronger solver changes nothing there
(and is provably exact-equal where it completes). The large gap only exists on 26-28 tile racks
with no hoard term (+9 to +10 pts/rack, up to +38), i.e. for a bot that actually holds
everything to the end — if the hold-everything/no-starvation design is ever adopted (or in
heads-up, 88 auctions, bigger racks), `strongPartition` is the piece that makes it pay. The
mid-match plan (hoard objective, 16-20 tiles) is within ~1 point of a 300k-node search, so
budget is not what limits v1's valuations either. Flush timing: flushAt=2 costs 0.05 place /
0.6 pts in replay (the premium for a latency-safe flush); preFlushAt=3 (7+ letter words out
from bagLeft <= 3) is free (+0.01 / +0.2) and is the recommended latency hedge if the operator
worries about the last window; playing 8s immediately and exact-gain bidding at bagLeft <= 3
change nothing. All margins are < 0.10 = noise; no WIN, no LOSS.

## 6. Risks
- Compute: `strongPartition` is only called at the flush (bagLeft <= flushAt) and is capped
  by `bigMs` (250 ms) and `bigBudget` (400k nodes); it exits at the cap with the best found
  (never worse than greedy). Under heavy CPU contention the cap is wall-clock, so it just
  explores less. `fastPartition` keeps the 3000-node budget and costs less than
  `bestPartition` per node (26-tile hoard valuation: 76 ms vs 115 ms under load, same budget);
  bid() still does two valuations, so on a 28-tile rack v1 itself is already at 60-230 ms per
  bid — the per-node filtering is the cheap fix if that ever matters.
- Nothing here reads data that is not live (`State` only). Deterministic apart from timing caps.
- The time cap makes the chosen partition machine-speed dependent: the words are always a
  valid disjoint set from the current rack, so a slower machine only loses points, never
  submits an invalid play.
- Flush timing: in replay there is no latency, so flushAt=2 / preFlushAt can only show their
  cost, not their insurance value; see 3c for the price. Live, the only play that depends on
  the last 1-second window is the tile won all-in at bagLeft=1 being played at bagLeft=0
  (`index.ts` calls words() before bid() on every auction event, same order as the arena).
- Heads-up (88 auctions): racks get bigger (more letters per player) so the flush/solver
  gap would matter more there than at 6 seats; untested here (no heads-up replays).

## 7. How to enable
- Strong flush solver only: in `src/strategy.ts`, in `words()` when `v.bagLeft <= this.p.flushAt`,
  return `strongPartition(this.dict, v.rack, this.dict.candidates(v.rack), 400000, 250).words`
  (function in `src/variants/flush-solver/policy.ts`, self-contained, depends only on engine.ts).
- Cheaper/better valuations at the same budget: replace the `bestPartition(...)` call in
  `Brain.plan()` with `fastPartition(this.dict, r, c, left, this.p.budget, b >= 1 ? 0 : 8)`.
- Or run the variant as is: `REPLAY_POLICY=./variants/flush-solver/policy.ts` with over
  `{"solver":1}` (flush solver), `{"fastPlan":1}` (all valuations), knobs: `flushAt`,
  `preFlushAt`, `preFlushLen`, `playNowLen`, `exactGainAt`, `strongBidAt`.
