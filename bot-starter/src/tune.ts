// Param sweep: npx tsx src/tune.ts
import { Dict } from "./engine.js";
import { DEFAULT_PARAMS, type Params } from "./strategy.js";
import { brainBot, evaluate, greedyBot, simBot, starterBot, type Game } from "./sim.js";

const d = Dict.load();
const N = Number(process.argv[2] ?? 30);
const grid: Partial<Params>[] = JSON.parse(process.argv[3] ?? "[{}]");
for (const over of grid) {
  const p = { ...DEFAULT_PARAMS, ...over };
  const rivals = (g: Game) => [
    brainBot(g, p),
    greedyBot(g, 3, "g3"),
    greedyBot(g, 4, "g4"),
    greedyBot(g, 2, "g2"),
    starterBot(g),
    simBot(g, "aggr"),
  ];
  const r = evaluate(d, rivals, N, 7);
  console.log(JSON.stringify(over), "brain", r.brain, "g3", r.g3.score, "g4", r.g4.score);
}
