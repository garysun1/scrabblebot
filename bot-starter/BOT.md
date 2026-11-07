# Brain bot

Strategy for the ScrabbleBot auction game, built on the starter.

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
- **Words:** plays whatever the best partition says. Mid-game that's 7+ letter words
  (3x) as soon as they appear; short words get held. In the last two auctions it
  plays everything.
- **Bids:** `V(rack + letter) - V(rack)`, times 3, scaled by cash on hand relative to
  what the rest of the match will cost. Never bids on the last auction (that tile can't be
  played). Re-bids when a word play changes cash. Shades bids 40% in first-price
  lobbies.

## Run

```bash
npm install
npm run generate                       # needs the spacetime CLI
BOT_NAME=<name> BOT_TOKEN=<token> npm start
BRAIN_PARAMS='{"kappa":3.5}' BOT_NAME=<name> npm start   # live tuning
BOT_NAME=<name> TOURNAMENT_ID=<id> npm start             # register for the tournament
```

## Offline simulator

`src/sim.ts` mirrors the module's rules; it includes the house sim bots, the starter
bot and "greedy Nx" rivals (bid N times face value, play 7+ words, flush at the end).

```bash
npx tsx src/sim.ts 100            # fixed tables
npx tsx src/pool.ts 500 '[{"name":"a"},{"name":"b","kappa":3.5}]' 7   # random 6-seat pool
npm test
```
