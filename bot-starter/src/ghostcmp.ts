// Compare the v1 ghost's bids with what the live bot did in our own matches.
import { Dict } from "./engine.js";
import { DEFAULT_PARAMS } from "./strategy.js";
import { loadMatches, mulberry, replayMatch, v1Policy } from "./replay.js";
const d = Dict.load();
const all = loadMatches();
for (const m of all) {
  const pol = v1Policy(d, DEFAULT_PARAMS);
  const bids: number[] = [];
  const orig = pol.bid.bind(pol);
  pol.bid = (s) => { const b = orig(s); bids.push(Math.round(b)); return b; };
  const r = replayMatch(d, m, pol, mulberry(m.id));
  const gasWon = m.auctions.filter((a) => a[3] === 178).length;
  const ghostWouldBeat = m.auctions.filter((a, i) => bids[i] > a[1]).length;
  const avgBidByPhase = [0, 1, 2, 3].map((ph) => {
    const xs = bids.filter((_, i) => Math.floor((i * 4) / 68) === ph);
    return (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1);
  });
  const zeros = bids.filter((b) => b === 0).length;
  console.log(`m${m.id}: live gas won ${gasWon} | ghost won ${r.letters} score ${r.score} place ${r.place}/7 endbal ${r.endBal} | ghost bids beat archived top on ${ghostWouldBeat} auctions | ghost avg bid by quarter ${avgBidByPhase.join("/")} zeros ${zeros}`);
}
