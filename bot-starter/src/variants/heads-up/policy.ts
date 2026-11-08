// heads-up variant: the v1 brain with parameter overrides keyed by the number
// of rivals at the table (State.rivals.length, live = seats - 1). At 6 seats
// (5 rivals, and the replay arena's 6-rival ghost seat) this is exactly the
// live bot.
// Run:  REPLAY_POLICY=./variants/heads-up/policy.ts <tsx> src/replay.ts x 200 11 '{}'
import type { Dict } from "../../engine.js";
import type { State } from "../../brain2.js";
import { Brain } from "../../strategy.js";
import type { Policy } from "../../replay.js";
import { paramsFor, type Over } from "./overrides.js";

export function makePolicy(d: Dict, over: Over, _rnd: () => number): Policy & { letter: number } {
  const brains = new Map<number, Brain>();
  const brainFor = (s: State): Brain => {
    const n = s.rivals?.length ?? 5; // unknown -> assume a full 6-seat table
    let b = brains.get(n);
    if (!b) {
      b = new Brain(d, paramsFor(n, over));
      brains.set(n, b);
    }
    return b;
  };
  const pol = {
    letter: 0,
    reset() {},
    bid(s: State) {
      return brainFor(s).bid(
        { rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice, maxRivalBalance: s.maxRivalBalance, unseen: s.unseen },
        pol.letter,
      );
    },
    words(s: State) {
      return brainFor(s).words({ rack: s.rack, balance: s.balance, bagLeft: s.bagLeft, firstPrice: s.firstPrice });
    },
    observePrice(_s: State, _letter: number, _paid: number, _weWon: boolean) {},
  };
  return pol;
}
