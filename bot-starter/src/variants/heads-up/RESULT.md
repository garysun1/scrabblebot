# heads-up: parameter overrides keyed by the number of rivals (bracket tables, heads-up final)

## 1. Idea and mechanism

All of v1's tuning (market floor = 6-seat median winning bids, late fill of 12 coins
over the last 16 auctions, pace `spendPerAuction` sized for winning ~13 of 68 tiles)
is for 6 seats. The bracket shrinks tables 6 -> 5 -> 4 -> 3 and the final is heads-up
(88 auctions, each player wins ~44 tiles). The live client already knows the seat
count (`State.rivals.length` = seats - 1), so the brain can run a different parameter
set per table size without touching 6-seat behaviour. I used self-play
(`src/sim.ts` mirrored into my folder with stronger heads-up rivals: a copy of the
live brain, a budget-pacing rival, a "bid 1 and flush" rival) to (1) diagnose the
6-seat rules at 1-3 rivals and (2) search for overrides that win more small-table
self-play while being a no-op at 6 seats by construction.

## 2. Files created (all in `src/variants/heads-up/`)

- `overrides.ts` - `paramsFor(nRivals, over)`: live `DEFAULT_PARAMS` for >= 5 rivals,
  `SMALL_TABLE[n]` overrides for 1-4 rivals, plus optional `r1..r4` nested overrides
  from the CLI json.
- `policy.ts` - replay/live policy: one `Brain` per rival count, chosen by
  `s.rivals.length` at every `bid()`/`words()` call (falls back to 6-seat params if
  `rivals` is missing). Identical to the live bot at 6 seats and in the replay arena
  (ghost seat has 6 rivals).
- `sim_hu.ts` - copy of `src/sim.ts` with import paths fixed, per-player `tiles`/end
  `bal` stats, new rivals (`self` = unmodified live brain, `lean` = live brain without
  floors, `ones` = bid 1 on everything + flush, `pacer` = budget-paced value bidder,
  `greedy3`, `field.5`) and mixes `hu_self hu_old hu_lean hu_ones hu_greedy hu_greedy3
  hu_field hu_fieldlo hu_pacer hu_cheap three three_self four four_self six`.
  `BRAIN_PARAMS='{"r1":{...}}'` feeds the player under test through `paramsFor`, i.e.
  exactly what `policy.ts` does. `SIM_BUDGET=<n>` lowers the partition budget for ALL
  brain players symmetrically (all runs below used 200; needed because the box ran at
  load ~100 tonight). Prints a running partial every 10 matches.
- `RESULT.md` - this file.

## 3. Diagnosis: how the 6-seat rules behave with 1-3 rivals (question 1)

Facts from `src/strategy.ts` + `market.json`, checked with the sim:

- **Market floor** (`marketFloor 1.0 x` median winning bid, applied when gain >= 2): the
  medians are max-of-5-rivals prices: 7-16 coins for 1-pointers, 13-23 for 3-4
  pointers, J/X/Q/Z 30-40. Heads-up the auction is Vickrey against ONE rival, so the
  floor costs nothing against a low bidder (we pay his 1-3 coins) but against a
  field-like rival (bids ~10-16 on everything) it makes us pay 10-16 for every letter
  with a marginal value of 2+, i.e. far above our own valuation, until
  `balance < 2*floor` switches it off. In the mirror match both brains bid the same
  floors and tie at random -> both pay the full floor on most letters. Also the phase
  index `done = 67 - bagLeft` is negative for the first 20 of 88 auctions, so the
  "early" medians are used for 37 auctions instead of 14 (harmless, slightly higher
  floors on 1-pointers early).
- **Late fill** (bid >= 12 in the last 16 auctions while balance >= 24): sized for
  winning ~3 of the last 16 tiles at 6 seats. Heads-up we win ~8 of them; 16 x 12 =
  192 coins is unaffordable, so the `balance >= 24` guard simply drains the balance to
  ~24 and then the fill stops. Not catastrophic, but it is a blind 12-coin bid on
  letters worth 1-2 points of marginal value, paid at the rival's price.
- **Pace** (`cash = sqrt(balance / (bagLeft x 2.26))`, clamp 0.5-2.45): at 6 seats the
  first auction has bagLeft 67 -> factor 0.81; heads-up bagLeft 87 -> factor 0.71, i.e.
  we bid ~12% LOWER at a table where we will win 3.4x more tiles (44 of 88 instead of
  13 of 68). The late ramp `progress = 1 - bagLeft/63` is clamped to 0 for the first
  24 heads-up auctions. Both say: v1 is under-paced heads-up early, then relies on the
  floors - and section 4 shows that this patience is exactly what wins under Vickrey.
- **Hoard horizon / flush** (`horizon 16`, `flushAt 1`): both are in auctions-remaining,
  not match fraction, so 88 auctions change nothing. Racks reach 40-50 tiles heads-up
  (hold-everything policy); `bestPartition` at budget 3000 still finds 250-290 point
  flushes, and CPU per decision stays under 65 ms (section 7).
- **All-in at bagLeft <= 1**: correct heads-up too (cash is worth 0 one auction later,
  we pay only the rival's bid, capped at his balance + 1).
- **minBid 1**: good (free tiles when the rival bids 0); against a rival that also bids
  1 on everything, ties are coin flips, so `minBid 2` wins all of them for 1 coin while
  only risking 2 coins on letters with gain <= 0.

## 4. Self-play evaluations (question 2)

Harness: `SIM_BUDGET=200 BRAIN_PARAMS='<json>' node_modules/.bin/tsx
src/variants/heads-up/sim_hu.ts 40 <mix> 11`. The box ran at load average 100-110
(4 cores shared with ~110 other replay processes), so every run below uses the
symmetric partition budget 200 for all brain players (both sides equally handicapped;
a documented approximation of the live budget 3000). In `hu_self` the baseline is
exact by symmetry: 0.50 win / 1.50 place; a candidate is a win only if it beats that
by well over the standard error (~0.08 at n=40).

**Sample sizes**: at load ~100 each worker got ~0.015 cores, so by the hard stop 4 of
the 10 settings reached the full n=40 (marked FINAL) and the rest n=20-30 (lines are
verbatim; `partial n=..` = the last running partial before the stop). Standard error
of a win rate is 0.11 at n=20, 0.08 at n=40: effects of >= 0.25 are meaningful at
n=20, and all of the losses below are of that size or bigger.

Stock baselines (`src/sim.ts 40 hu_old ...`) never got CPU on this box and were killed;
the `hu_self` mirror has an exact baseline instead.

| run | mix / setting (`BRAIN_PARAMS`) | result (verbatim) |
|---|---|---|
| self_PKM | hu_self, `{"r1":{"spendPerAuction":1.3,"cashMax":3,"kappa":3.2,"minBid":2}}` | `partial n=20 \| brain: score 187.0 place 1.85 win 0.15 tiles 34.6 bal 19 \| self: score 325.8 place 1.15 win 0.85 tiles 52.4 bal 96` (n=10: 0.00) |
| self_P | hu_self, `{"r1":{"spendPerAuction":1.3,"cashMax":3}}` | `partial n=30 \| brain: score 215.9 place 1.73 win 0.27 tiles 37.4 bal 24 \| self: score 296.9 place 1.27 win 0.73 tiles 49.6 bal 62` |
| self_F0 | hu_self, `{"r1":{"marketFloor":0,"lateFillN":0}}` | `partial n=20 \| brain: score 247.7 place 1.60 win 0.40 tiles 39.3 bal 83 \| self: score 274.4 place 1.40 win 0.60 tiles 47.7 bal 43` (n=10: 0.30) |
| self_slow | hu_self, `{"r1":{"spendPerAuction":3.5}}` | FINAL `hu_self n=40 seed=11 BRAIN_PARAMS={"r1":{"spendPerAuction":3.5}} \| brain: score 271.7 place 1.50 win 0.50 tiles 46.9 bal 55 \| self: score 242.3 place 1.50 win 0.50 tiles 40.1 bal 65 (122737ms)` |
| field_base | hu_field, `{}` (live params) | `partial n=20 \| brain: score 373.6 place 1.00 win 1.00 tiles 60.9 bal 228 \| field: score 121.3 place 2.00 win 0.00 tiles 25.3 bal 27` |
| field_PKM | hu_field, `{"r1":{"spendPerAuction":1.3,"cashMax":3,"kappa":3.2,"minBid":2}}` | `partial n=20 \| brain: score 293.6 place 1.40 win 0.60 tiles 47.9 bal 191 \| field: score 198.7 place 1.60 win 0.40 tiles 39.1 bal 74` |
| field_F0 | hu_field, `{"r1":{"marketFloor":0,"lateFillN":0}}` | FINAL `hu_field n=40 seed=11 BRAIN_PARAMS={"r1":{"marketFloor":0,"lateFillN":0}} \| brain: score 353.7 place 1.15 win 0.85 tiles 57.0 bal 231 \| field: score 147.9 place 1.85 win 0.15 tiles 30.0 bal 39 (249398ms)` |
| three_cand | three_self (brain, self, field), `{"r2":{"spendPerAuction":1.6,"cashMax":3,"kappa":2.9,"minBid":2}}` | FINAL `three_self n=40 seed=11 BRAIN_PARAMS={"r2":{"spendPerAuction":1.6,"cashMax":3,"kappa":2.9,"minBid":2}} \| brain: score 148.2 place 2.02 win 0.07 tiles 23.7 bal 22 \| self: score 251.0 place 1.13 win 0.88 tiles 40.0 bal 57 \| field: score 81.9 place 2.85 win 0.05 tiles 18.3 bal 19 (538388ms)` (symmetric baseline vs self: equal place / win 0.33 each) |
| three_F0 | three_self, `{"r2":{"marketFloor":0,"lateFillN":0}}` | FINAL `three_self n=40 seed=11 BRAIN_PARAMS={"r2":{"marketFloor":0,"lateFillN":0}} \| brain: score 164.6 place 1.75 win 0.28 tiles 26.0 bal 21 \| self: score 241.3 place 1.27 win 0.72 tiles 38.7 bal 44 \| field: score 73.9 place 2.98 win 0.00 tiles 17.1 bal 19 (197178ms)` |
| replay smoke | `REPLAY_FILE=./replay_hack.json REPLAY_SPLIT=test REPLAY_SEEDS=1 REPLAY_POLICY=./variants/heads-up/policy.ts src/replay.ts x 2 11 '{}'` | `policy:./variants/heads-up/policy.ts {} n=2: avg place 2.00 score 78.0 win 0.00 letters 10.5 endbal 19 places[1..7]=0,2,0,0,0,0,0 (856ms/match)` (load check only: the policy runs in the arena; at 6 rivals it is the live brain by construction, so the BASELINES.txt lines apply unchanged) |

(`bal` includes the flush income paid in the last auction, so it is not pure waste.)

What the numbers say (mechanism, not just the sign):

- **Aggression loses heads-up** (self_PKM 0.15, self_P 0.27, three_cand 0.07 at n=40,
  field 1.00 -> 0.60). Under Vickrey the winner pays the loser's bid. The pace-up/denial bidder wins
  the contested early letters but pays the opponent's price for every one of them,
  front-loads its 100 coins (`bal 19` at the end vs 113) and is dry when the late
  letters go for 1-12 coins; the unmodified brain's `sqrt(balance/need)` pace keeps a
  reserve that grows in relative terms as `need = bagLeft x 2.26` shrinks, then the late
  fill and the all-in buy the back half of the bag. Against a leader-like fixed
  ~10-16 coin bidder (field) the live brain is already at 1.00: the rival burns its
  cash paying our floors, and we take 60 of 88 tiles.
- **Floors off also loses** (self_F0 0.40 at n=20 with 83 coins unspent and 39 vs 48
  tiles; three_F0 0.28 at n=40 vs 0.33 symmetric, place 1.75 vs self 1.27; field_F0
  0.85 at n=40 vs the live brain's 1.00 at n=20). The
  market floor + late fill are what make v1 actually deploy cash mid-match; with our
  raw marginal values (2-8 coins) the mirror wins every contested letter and pays
  only our low bid for it. So the "6-seat medians are too high for one rival" worry
  is wrong in practice: in Vickrey we never pay our own floor, we pay the rival's bid,
  and the floor mainly stops the rival from getting letters at 2-3 coins.
- **Slower pace is exactly neutral** (self_slow, the one run that reached n=40: win 0.50,
  place 1.50, but more tiles 46.9 vs 40.1 and a higher mean score 272 vs 242): bidding
  lower early lets the mirror take the contested early letters cheaply, and the saved
  cash buys back volume late (cheap letters -> bigger flush) without winning more
  matches. The higher mean score is the only positive signal of the night and would
  need a 100+ match run to separate from noise; not enabled.
- The three sub-questions in (1) therefore resolve as: floors/late fill = keep; horizon
  and flush = already auction-count based, keep; all-in at bagLeft <= 1 = keep;
  minBid 1 = keep (minBid 2 was only tested inside PKM; its tie-winning effect is
  worth at most a few 1-coin tiles and did not rescue PKM).

## 5. Recommended overrides and how the client switches (question 3)

`State.rivals` is built in `src/index.ts:stateFor()` from `matchParticipant` minus
ourselves, so `rivals.length` = seats - 1, known from the first auction (and `ctxFor`
already derives `totalAuctions = 98 - seats x 5`). Switch exactly like
`src/variants/heads-up/policy.ts`: keep `Map<nRivals, Brain>` and construct
`new Brain(dict, paramsFor(s.rivals.length))` lazily; call `bid`/`words` on the brain
for the current count. Nothing changes for 5+ rivals (6-seat Swiss rounds, and the
replay arena's 6-rival ghost seat), so the 6-seat baselines are untouched by
construction: `REPLAY_POLICY=./variants/heads-up/policy.ts ... '{}'` is the live bot.

**Recommended overrides: none.** `SMALL_TABLE` in `overrides.ts` ships empty; the
tested candidates are kept there as `CANDIDATES` for reference. Live, do NOT switch
parameter sets by table size; the live `DEFAULT_PARAMS` are the best small-table
setting I found. The switching plumbing (`policy.ts` / `paramsFor`) is in place should a
later, better-sampled search find a real small-table win; enabling an override is one
line in `SMALL_TABLE`.

## 6. Verdict

**NEUTRAL (clear negative result on the idea; no change recommended).** Every
small-table override tried lost heads-up self-play against the unmodified live brain
(win 0.15 / 0.27 / 0.40 vs the symmetric 0.50; the slow-pace one exactly 0.50 at
n=40), lost 3-seat self-play (0.07 and 0.28 at n=40 vs 0.33 symmetric), and the
aggressive one cut the win rate against a 6-seat-priced rival from 1.00 to 0.60
(floors-off: 1.00 -> 0.85). The live parameters are already a sound heads-up strategy:
patient sqrt pace, market floors that make the rival pay, late fill and all-in to spend
down. 6-seat behaviour is untouched by construction (baselines unchanged: test s11
2.09, s23 2.08, strong 2.07). Caveat: n=20-40 per setting because the box ran at load
100; the aggressive losses are 3+ standard errors, the floors-off mirror result (0.40
at n=20, ~1 SE) is suggestive rather than proven.

## 7. Risks

- **Compute**: measured with `process.cpuUsage` at the live budget 3000: `bid()` 45 ms
  CPU on a 28-tile rack, 38-65 ms on 40 tiles, 48-60 ms on 50 tiles; `words()` 12-31 ms.
  Heads-up racks grow to 40-50 tiles (we hold everything until the flush) and the
  budget stays well under the 150 ms guideline. No new data dependency: only
  `rivals.length` from the live `State`.
- **Rival model risk**: the small-table results are self-play against our own brain and
  hand-written rivals, not the archive (there is none for small tables). A leader bot
  that adapts its pace to heads-up (budget-paced like `pacer`, untested for lack of CPU)
  is the main unknown; against the mirror and against a 6-seat-priced rival the live
  brain already wins, so shipping no override is the safe choice.
- **Elimination tables (3-5 seats)**: last place is eliminated, so place matters more
  than win rate there; the tested 3-seat candidates were worse on place too (2.02 and
  1.75 vs the live brain's 1.13 / 1.27 at the same table).
- If `rivals` ever arrives empty (subscription race on the first auction) the policy
  falls back to the 6-seat parameters (`?? 5`).
