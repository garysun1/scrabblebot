// letter-target variant: the v1 brain plus (1) a letters-won target trajectory
// that moves the market floor, and (2) live price heat calibrated from the
// clearing prices seen in this match. Both need only public information:
// whether we won each auction and what it cleared at.
//
// Run:
//   REPLAY_FILE=./replay_hack.json REPLAY_SPLIT=test REPLAY_SEEDS=4 \
//   REPLAY_POLICY=./variants/letter-target/policy.ts \
//   node_modules/.bin/tsx src/replay.ts x 200 11 '{"tgtLetters":15,"heatW":0.15}'
import type { Dict } from "../../engine.js";
import type { State } from "../../brain2.js";
import type { Policy } from "../../replay.js";
import { Brain, DEFAULT_PARAMS, marketSecond, type Params } from "./strategy.js";

export function makePolicy(d: Dict, over: Partial<Params>, _rnd: () => number): Policy & { letter: number } {
  const p: Params = { ...DEFAULT_PARAMS, ...over };
  const brain = new Brain(d, p);
  let won = 0; // letters we won so far this match
  let heat = p.heat0; // EMA of paid / archive medSecond
  const pol = {
    letter: 0,
    reset() {
      won = 0;
      heat = p.heat0;
    },
    bid(s: State) {
      return brain.bid(
        {
          rack: s.rack,
          balance: s.balance,
          bagLeft: s.bagLeft,
          firstPrice: s.firstPrice,
          maxRivalBalance: s.maxRivalBalance,
          unseen: s.unseen,
          won,
          auctionIndex: s.auctionIndex,
          totalAuctions: s.totalAuctions,
          heat,
        },
        pol.letter,
      );
    },
    words(s: State) {
      return brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
    },
    observePrice(s: State, letter: number, paid: number, weWon: boolean) {
      if (weWon) won++;
      if (p.heatW > 0 && paid > 0) {
        const ref = marketSecond(letter, s.bagLeft, s.totalAuctions);
        const ratio = Math.max(0.3, Math.min(3, paid / ref));
        heat = heat * (1 - p.heatW) + ratio * p.heatW;
      }
    },
  };
  return pol;
}
