# Brain bot

Strategy for the ScrabbleBot auction game, built on the starter.

## Brain v2 (default)

`src/brain2.ts`. Built after reading the public code of two tournament bots
(K-13, the tournament #1 champion, and a Rust Vickrey bot) and ~450 archived
live matches.

- **Letter value by look-ahead.** V(rack) = expected best word partition of the
  rack plus k tiles sampled from the unseen pool (bag + rivals' hidden tiles,
  tracked from auctions and word plays). A letter is worth V(rack+L) - V(rack)
  on the same draws. k = 1.1 x the number of tiles we can still afford.
- **Bid = value / lambda.** Lambda (points per coin) is solved by bisection so
  that bidding this way on every remaining auction spends the balance plus a
  share of expected word income. It falls as the match goes on, so bids rise
  and cash ends near zero (leftover cash is zero score).
- **Market model.** Winning-bid distribution per letter and match phase, fitted
  from the archive (`src/market.json`, `scripts`: see `scratchpad/fitmarket.py`
  in the session), scaled by a per-match "heat" calibrated from clearing prices.
- **Words.** A word is played only if reward x (1 + 0.3 lambda) + V(rest) beats
  V(hold) by 2.5 points; everything is flushed in the last two auctions.
- **Timing.** Anchor bid from a cached table within a few ms of the auction
  opening, then a refined bid with fresh samples; lambda recomputed between
  auctions. All-in on the last usable letter, capped at the richest rival + 1.
- **Replay arena** (`src/replay.ts`): plays the policy as a ghost 7th seat inside
  archived live matches against the real recorded top bids. Tune with it:
  `npx tsx src/replay.ts v2 40 7 '{"lambdaScale":1.8}'`.

`BRAIN=v1` runs the older heuristic brain below.

## Brain v1

## How it plays

- **Rules it exploits** (read from `spacetimedb/src/game.ts`): score only comes from
  words; leftover cash and tiles are worth nothing at the end; there's no rack limit;
  unbid tiles are discarded, so `matchState.bagTotal` says exactly how many auctions
  remain; the match ends the instant the last auction closes.
- **Rack value** `V(rack)` = best set of disjoint words (branch-and-bound over an
  anagram index of the ENABLE list) + a decaying "hoard" value for kept tiles
  (face value scaled by how often the letter shows up in 7-8 letter words, vowel
  balance and duplicate penalties). The hoard term fades to zero over the last
  ~14 auctions.
- **Words:** mid-game it only cashes 7+ letter words (5+ if cash drops under 15);
  everything else is held. In the last two auctions it plays the best partition of
  the whole rack.
- **Bids:** `V(rack + letter) - V(rack)`, times 3, scaled by cash on hand relative to
  what the rest of the match will cost. Goes all-in on any useful letter in the last
  usable auction, never bids more than the richest rival's balance + 1, and never
  bids on the last auction (that tile can't be played). Re-bids when a word play changes cash. Shades bids 40% in first-price
  lobbies.

## Run

```bash
npm install
npm run generate                       # needs the spacetime CLI
BOT_NAME=<name> BOT_TOKEN=<token> npm start
BRAIN_PARAMS='{"kappa":3.5}' BOT_NAME=<name> npm start   # live tuning
BOT_NAME=<name> TOURNAMENT_ID=<id> npm start             # register for the tournament
```

The bot exits if its feed stalls mid-match. Run it in a restart loop so it reconnects:

```bash
while true; do BOT_NAME=<name> TOURNAMENT_ID=<id> npm start 2>&1 | tee -a bot.log; sleep 1; done
```

## Offline simulator

`src/sim.ts` mirrors the module's rules; it includes the house sim bots, the starter
bot and "greedy Nx" rivals (bid N times face value, play 7+ words, flush at the end).

```bash
npx tsx src/sim.ts 100            # fixed tables
npx tsx src/pool.ts 500 '[{"name":"a"},{"name":"b","kappa":3.5}]' 7   # random 6-seat pool
npm test
```
