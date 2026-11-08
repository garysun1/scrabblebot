// Minimal variant: wraps the current v1 brain and shows how to plug in.
// Run:  REPLAY_POLICY=./variants/example/policy.ts <tsx> src/replay.ts x 200 11 '{"kappa":2.4}'
import type { Dict } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "../../strategy.js";
import type { Policy } from "../../replay.js";

export function makePolicy(d: Dict, over: Partial<Params>, _rnd: () => number): Policy & { letter: number } {
  const brain = new Brain(d, { ...DEFAULT_PARAMS, ...over });
  const pol = {
    letter: 0,
    reset() {},
    bid(s: State) {
      // s has: rack, balance, bagLeft, totalAuctions, unseen, maxRivalBalance, rivals[{id,balance}],
      // score, rivalScores{id:score}, auctionIndex. Our letter is pol.letter (0..25).
      return brain.bid({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice, maxRivalBalance: s.maxRivalBalance, unseen: s.unseen }, pol.letter);
    },
    words(s: State) {
      return brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
    },
    observePrice(_s: State, _letter: number, _paid: number, _weWon: boolean) {},
  };
  return pol;
}
