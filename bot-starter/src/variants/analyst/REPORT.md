# Analyst report: what the leaders actually do (archive reverse-engineering)

Slug `analyst`. Analysis only; no bidding policy was shipped. Written 02:46-03:05 UTC.

## Data and method

- Script: `src/variants/analyst/analyze.ts` (run `node_modules/.bin/tsx src/variants/analyst/analyze.ts`,
  ~50 s CPU, 5 min wall on the loaded box). Raw output:
  `/tmp/claude-0/-home-user-scrabblebot/f70bb7c9-93b8-55b6-a54d-fb4c42344a5b/scratchpad/analyst_out.txt`.
- Sources: scratchpad `x_/y_/z_ar.jsonl` (auction results), `x_/y_/z_wp.jsonl` (word plays with timestamps),
  `x_tb.jsonl` + `w_tb.jsonl` (archived winning bid per auction id), `*_mp.jsonl` (participants: score, coins).
  651 matches (ids 42900-45448), 6-seat tables with 60+ auctions only.
- Leaders verified in `bots2.jsonl`: Lbender 201, RackMaw 193, LexForge-1107 207, GodOfThudner 171
  (358 leader seats). Comparison group "FIELD" = 400 sampled non-leader seats from the same tables.
- Rack reconstruction: minimal set of hidden starting tiles consistent with the plays (letter deficits
  of plays vs tiles won), then rack(t) = hidden + won(<=t) - played(<=t). Leaders leave on average only
  0.0-0.2 hidden tiles unrevealed (field 0.6), so their racks are essentially fully observed.
- Bids are only observable on auctions a bot WON (the archive stores the top bid only). "Let go" auctions
  give rack features but not the bot's own bid. "med" = median archived winning bid for that letter in
  that fifth of the match (same definition as `src/market.json` medTop).
- Sanity vs the brief: leaders avg place 2.12 vs field 3.58; letters won 13.0 vs 11.0; median price 12 both;
  5+pt win rate early/mid/late 40/33/24% (leaders) vs 15/15/16% (field). Matches the brief's table.

## Headline: the leaders are NOT high bidders. They are a different machine.

Median bid / market median over all won auctions: Lbender 0.95, RackMaw 1.00, LexForge-1107 1.00,
GodOfThudner 1.05 (field 1.00). Rack size does not move their bid (bid/med 1.00 at 0-5 and 6-9 tiles).
What differs is (a) WHICH letters they bid at/above the median and when, (b) that they play every 7+
word the moment it exists and reinvest, so their racks stay tiny (mean 5.8 visible tiles at a premium
auction; only 2.5% of auctions with 10-14 tiles, never 15+), and (c) a poverty/late rule that bids
~80-100% of balance.

## Q1. Premium letters (K J X Q Z): when do they bid high, what does the rack look like?

Leaders, premium auctions, early+mid phases (n=794), split by what `d.nearWords(rack+L, L, 2, 7)` finds:

| near-7 status at the auction | n | leader win % | leader bid/med (won) | field win % |
|---|---|---|---|---|
| a 7+ containing L is playable now (miss 0) | 69 | 52% | 1.13 | 25% |
| only within 1 tile | 270 | 43% | 1.15 | 21% |
| only within 2 tiles | 270 | 33% | 1.03 | 13% |
| none within 2 | 185 | 28% | 1.00 | 10% |

Rack at premium auctions, won vs let go (leaders):

| phase | outcome | n | visible rack | vowel share | balance | 7 in 1 tile | 7 in 2 tiles | #7s within 2 |
|---|---|---|---|---|---|---|---|---|
| early | WON | 149 | 5.8 | 0.45 | 87 | 49% | 90% | 32.7 |
| early | let go | 220 | 5.7 | 0.39 | 79 | 30% | 78% | 25.3 |
| mid | WON | 142 | 5.9 | 0.43 | 59 | 56% | 75% | 69.4 |
| mid | let go | 283 | 5.7 | 0.39 | 47 | 42% | 70% | 54.6 |
| late | WON | 102 | 4.8 | 0.46 | 39 | 38% | 64% | 37.0 |
| late | let go | 319 | 3.7 | 0.37 | 24 | 26% | 42% | 30.9 |

Their HIGH premium bids (>= 1.3 x median, n=62) vs their normal premium wins (n=331): same rack size (5.8 vs
5.6), same balance (64 vs 65), but vowel share 0.50 vs 0.44, "7 within 1 tile" 68% vs 45%, and later in
the match (bagLeft 30.6 vs 37.3). Won premium letters are paid at 0.85 x median (early/mid) because the
second price is low: nobody else bids seriously on a Q/Z/X, so a bid of 1.05-1.15 x median wins 40% of them
cheaply. Our v1 wins 19% of early premium letters.

Takeaway: premium bidding is conditional on a near-7 (within ONE tile is the live signal, two tiles is
weak) and on a vowel-balanced rack, but the baseline is "always bid about the median on premium letters
early" (28% win rate even with no near-7, field 10%). Both parts matter.

## Q2. What triggers their word plays?

1064 leader play calls (526 contain a 7+ word), 1057 field calls (468 with 7+):

| | leaders | field |
|---|---|---|
| auctions left at a 7+ play (mean / median) | 29.8 / 30 | 34.1 / 34 |
| rack size before a 7+ play -> leftover after | 9.1 -> 1.8 | 8.8 -> 1.5 |
| balance before a 7+ play | 21.5 | 34.9 |
| 7+ play uses the letter won in the immediately preceding auction | 84% | 90% |
| share of auctions with a playable 7+ sitting unplayed in the rack | 8% (5/12/7% by third) | 7% |
| consecutive sampled auctions a playable 7+ sat before being played (median) | 0 (mean 0.86) | 0 |
| words per call | 1.02 | 1.02 |
| played the full best partition (`bestPartition`, budget 3000) | 56% | 65% |
| points / best-partition points | 0.95 | 0.95 |
| a higher-reward single word was available and not played | 7% | 10% |
| short-word (<7) calls: auctions left mean/median | 9.3 / 4 | 16.8 / 8 |
| short-word calls: balance before, points, had a 7 available | 7.4, 17.7, 5% | 24.1, 14.4, 2% |
| short-word calls with <= 2 auctions left (flush) | 225 of 538 | 149 of 589 |
| 7+ plays by balance 0-9 / 10-19 / 20-39 / 40+ | 154 / 136 / 156 / 80 | 65 / 94 / 113 / 196 |
| ... mean auctions left in those balance buckets | 20 / 26 / 34 / 46 | 17 / 25 / 31 / 46 |
| last play at auctions left | 4.4 | 8.5 |
| visible tiles / face left unplayed at the end | 0.5 / 1.2 | 0.8 / 1.9 |
| points by auctions left: 41+ / 26-40 / 16-25 / 8-15 / 3-7 / 0-2 | 21% / 30% / 18% / 14% / 7% / 10% | 30% / 23% / 17% / 15% / 8% / 7% |

Rules that fit the data:
- Play a 7+ word as soon as it exists (median hold 0 auctions; 84% of 7+ plays are triggered by the tile just
  won). They do NOT hold 7s to grow them into 8s. They play one word per call: the best single word (93% of
  the time the top-reward word), and keep the 1-2 leftover tiles as stems instead of cashing a short
  word with them (44% of 7+ plays leave a playable short word on the rack).
- Short words (<7) are played only when starving (mean balance 7.4, i.e. starve threshold ~10, not 20) or
  at the flush (<= 2 auctions left).
- 55% of their 7+ plays happen with balance < 20, and the play timing tracks balance (poorer -> earlier in
  terms of auctions left). Combined with the immediate-play rule this means: buy toward one 7, cash it,
  rebuild. 1.47 seven-plus plays per seat, racks never exceed ~14 tiles.

## Q3. How bids scale with balance and phase

Won auctions, archived top bid (fifths of the match):

| phase | leaders: n, median bid, bid/balance, bid/med, median balance, mean overpay (bid-paid) | field |
|---|---|---|
| 0 | 653, 17, 0.20, 0.93, 92, 3.4 | 952, 15, 0.17, 0.95, 89, 4.2 |
| 1 | 916, 14, 0.24, 1.00, 67, 2.9 | 928, 13, 0.21, 1.00, 69, 3.1 |
| 2 | 958, 14, 0.29, 1.00, 53, 3.0 | 856, 13, 0.26, 1.00, 54, 3.0 |
| 3 | 1101, 15, 0.39, 1.00, 41, 3.7 | 878, 14, 0.33, 1.00, 44, 3.9 |
| 4 | 999, 17, 0.90, 1.06, 27, 7.2 | 781, 17, 0.61, 1.00, 32, 6.9 |

By balance (leaders): bal 0-15 -> median bid = 100% of balance (bid/med 0.79); 16-30 -> 80% of balance
(bid/med 1.07, median bid 17); 31-50 -> 38%; 51-75 -> 24%; 76+ -> 18%. Field: 93%, 61%, 36%, 23%, 16%.
By letter group x third (bid/med, won): 5+pt 1.05/1.06/1.03 (median bids 39/36/30); 2-4pt 0.96/1.00/1.00;
1pt consonants 0.87/1.00/1.00 (early win rate 9% vs field 18%); vowels 0.93/1.00/1.07 (early win 12%).
Mean balance by auctions left (leaders): 60:86, 50:66, 40:55, 30:48, 20:35, 15:30, 10:27, 5:17, 2:13.
Most common bids are a tight band 10-17 in every phase for all four (GodOfThudner adds 20/24 early for
premium); there is no visible rack-size dependence (bid/med 1.00 at 0-5 and 6-9 tiles, 0.92 at 10-14).
RackMaw and LexForge-1107 have identical bid/med (1.00) and near-identical bid histograms, consistent with
one codebase; Lbender is the cheap one (0.95, 11.6 letters/match) and still places ~2.

Interpretation: bid ~ market median for the letter/phase, shaded x0.87-0.93 on commodity letters in the
first fifth, x1.05 on premium (x1.15 with a 7 within one tile), x1.07 on vowels late, and overridden by a
cash rule: bid ~0.8-1.0 x balance when balance <= 30 or in the last fifth. The spending pace is ~2.3
coins/auction for the first 20 auctions, then ~1.1/auction (replenished by plays), arriving at the last 15
auctions with ~30 coins and spending it all (13 left at 2 to go, 9-15 at the end per the brief).

## Q4. Other differences from our v1

- v1 holds every 7 (minMidLen 99) until starved (<20) or the flush; leaders play 7s immediately and
  starve at ~10. v1's hoard() rewards big racks; leaders never build them (max 14 tiles).
- v1's market floor applies only when marginal value >= 2; leaders bid at least the median on nearly
  everything mid/late (win 19-21% of vowels and 1pt consonants mid/late, field 15-17%) and shade
  commodity letters only in the first fifth.
- v1 all-in only at bagLeft <= 1 with a late fill of 12; leaders bid ~90% of balance throughout the
  last fifth (overpay 7.2 vs clearing price) and 100% of balance whenever balance <= 15.
- Free wins (paid <= 1) are rare for everyone (leaders 0.03/match, field 0.09): minBid 1 matters only
  heads-up.
- Tiles won in the last 3 auctions (unplayable waste): leaders 0.35/match, field 0.39: no edge there.
- Leaders' last play is at 4.4 auctions left; they end with 0.5 visible tiles. v1 flushes at bagLeft <= 1,
  so it also ends empty, but the leaders have already converted most tiles 25-35 auctions earlier.

## Hypotheses, ranked by estimated impact (each with evidence and how to test in v1)

1. Play-and-reinvest instead of hold (HIGH). Evidence: median hold of a playable 7+ is 0 auctions, 84% of
   7+ plays use the tile just won, racks never exceed ~14 tiles, 48% of leader points are scored with 15-40
   auctions left (our 38%), and leaders arrive at 20-to-go with 35 coins while converting at 5.0-5.3
   points/tile. Caveat: "hold 7s" improved v1 in replay (2.22 -> 2.07-2.12); the archive says holding is
   NOT what the leaders do, so the gain from holding is probably an artefact of v1 not reinvesting well (cash
   piles up; replay rivals don't react). Test as a package with #2/#4, not alone: `minMidLen: 7` plus the
   cash factor already present (`spendPerAuction`, `cashMax`), and a words() rule "play the top-reward 7+
   word, one per call, keep leftovers" (filter the partition to its single best 7+ word unless bagLeft <=
   flushAt). Param to add: `playNowLen` (7) and `holdIf8Within1` (optional: hold only if
   `candidatesPlusOne` shows an 8 within one tile and bagLeft > 20).

2. Premium-letter rule driven by "7 within ONE tile" and vowel balance (HIGH). Evidence: win rate 52/43/33/28%
   for miss 0 / 1 / 2 / none, bid/med 1.13-1.15 when a 7 is within 1 tile vs 1.00-1.03 otherwise; high
   bids have vowel share 0.50 vs 0.44. The nearW experiments tonight weighted miss<=2 words (2.14-2.32,
   worse); the live signal is miss<=1 and it should move the bid to ~1.15 x market median, not add value.
   Implementation: in the market-floor step for FACE>=5 letters with bagLeft > ~20: floor = med x (near1 > 0
   ? 1.15 : 1.0) and ignore `marketFloorMinGain` for these letters (leaders bid the median on premium even
   with nothing near). Keep `nearQ` for Q-without-U. Test: `premiumMult 1.05` only on premium letters +
   `premiumNear1Mult 1.15` on `nearWords(rack+L, L, 1, 7).idx.length > 0`; vowel share >= 0.4 as a gate.

3. Poverty/late cash rule (MEDIUM-HIGH). Evidence: bid = 100% of balance when balance <= 15, 80% when
   16-30, 90% of balance throughout the last fifth (field 61%), overpaying the clearing price by 7.2.
   v1: lateFill 12, all-in at bagLeft <= 1, lateMult 1.4 (1.6 was worse because it scales value, not cash).
   Test: in the last ~14 auctions, on any letter with marginal value > 0, bid max(current bid, 0.9 x balance)
   capped at `maxRivalBalance + 1`; separately, whenever balance <= 15 and the letter completes or is within 1
   of a word, bid the whole balance. Params: `lateCashFrac` (0.9, over last `lateFillN`), `poorAllIn` (15).

4. Bid at least the market median on everything from the second fifth on (MEDIUM). Evidence: leaders' bid/med
   is exactly 1.00 in phases 1-3 for vowels, 1pt and 2-4pt letters; they win 20% of all auctions vs our ~18%
   (13-14 letters vs 12-13) at the same median price 12. Test: `marketFloorMinGain` 2 -> 0 when bagLeft <
   ~54 (phase >= 1), keeping the cash factor as the only brake. Expect more letters at unchanged price.

5. Shade commodity letters in the first fifth, not premium (MEDIUM). Evidence: early bid/med 0.87 on 1pt
   consonants (win 9% vs field 18%), 0.93 on vowels (12%), 1.05 on premium (40% win), 0.96 on 2-4pt.
   Early flat multipliers > 1 were worse tonight because they raised everything. Test: `earlyMult` by letter
   group for the first 14 auctions: FACE==1 x0.87, vowels x0.93, premium x1.05. (Overlaps the sibling
   variant `group-phase-multipliers`; compare notes.)

6. Starve threshold 20 -> ~10 and starve plays limited to 5+ letter words (LOW-MEDIUM). Evidence: leaders'
   short-word calls happen at mean balance 7.4 and score 17.7 points each (5-6 letter words), never while a
   7 is available (5%). v1 cashes 5+ words below 20 coins. Test: `starveCash: 10`.

7. Hoard should not reward large racks (LOW-MEDIUM). Evidence: leaders' racks average 5.8 tiles at a premium
   auction and never reach 15; their bid does not grow with rack size. v1's hoard() (base 3.2 per tile, alpha
   1.19) makes a 20-tile rack look valuable and discourages playing. Test: cap the per-tile `base` to the
   first 9 tiles (or multiply hoard by min(1, 9/n)) when combined with #1.

8. One word per call, keep stems (LOW). Evidence: words/call 1.02, 44% of 7+ plays leave a playable short word
   unplayed, 93% play the single top-reward word. v1 already filters shorts out mid-match; verify it also plays
   only the best 7+ word when two 7s are available only if balance is low (data insufficient to separate).

9. Heads-up note (LOW, untested): all of the above is from 6-seat tables; in 2-player 88-auction finals the
   median market price collapses and rule #4 (bid the 6-seat median) would overpay. Use `firstPrice`/`rivals`
   length to scale the floor by the number of rivals (median x rivals/5 as a first guess).

## What was not done

No variant was prototyped or replayed: the analysis run alone took 5 minutes of wall clock on the shared
box and the hard stop is 03:15 UTC. Hypotheses 1-3 are the ones to try first, as one package
(`minMidLen 7` + premium near-1 floor + late/poor cash rule), evaluated per the brief on train then test
seeds 11/23 and the strong pool.
