// stem-potential variant: v1 brain with a dictionary-derived stem potential
// replacing/blending the hoard() heuristic. See ./strategy.ts.
// Run:  REPLAY_POLICY=./variants/stem-potential/policy.ts <tsx> src/replay.ts x 200 11 '{"potW":1,"hoardW":0.6}'
import type { Dict } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain, DEFAULT_PARAMS, type Params } from "./strategy.js";
import type { Policy } from "../../replay.js";

// Best configuration found on the train split (see RESULT.md); the JSON passed
// on the command line overrides these.
export const TUNED: Partial<Params> = {
  potW: 1.0,
  hoardW: 0.6,
  pWin: 0.3,
  potAgg: 0.15,
  potSat: 0,
};

export function makePolicy(d: Dict, over: Partial<Params>, _rnd: () => number): Policy & { letter: number; brain: Brain } {
  const brain = new Brain(d, { ...DEFAULT_PARAMS, ...TUNED, ...over });
  const pol = {
    letter: 0,
    brain,
    reset() {},
    bid(s: State) {
      return brain.bid(
        { rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice, maxRivalBalance: s.maxRivalBalance, unseen: s.unseen },
        pol.letter,
      );
    },
    words(s: State) {
      return brain.words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
    },
    observePrice(_s: State, _letter: number, _paid: number, _weWon: boolean) {},
  };
  return pol;
}
