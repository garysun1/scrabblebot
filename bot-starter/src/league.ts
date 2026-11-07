// League: several Brain variants at one table with aggressive rivals.
// npx tsx src/league.ts N '[{"name":"a","kappa":2}, ...]'
import { Dict } from "./engine.js";
import { DEFAULT_PARAMS } from "./strategy.js";
import { brainBot, evaluate, greedyBot, type Game } from "./sim.js";

const d = Dict.load();
const N = Number(process.argv[2] ?? 30);
const variants: ({ name: string } & Record<string, number | string>)[] = JSON.parse(process.argv[3]);
const fill = Number(process.argv[4] ?? 6 - variants.length);
const mix = (g: Game) => [
  ...variants.map((v) => brainBot(g, { ...DEFAULT_PARAMS, ...(v as any) }, v.name)),
  ...[4, 3, 5, 2].slice(0, fill).map((m) => greedyBot(g, m, `g${m}`)),
];
const r = evaluate(d, mix, N, Number(process.argv[5] ?? 11));
for (const [k, v] of Object.entries(r).sort((a, b) => a[1].place - b[1].place)) console.log(k.padEnd(8), v);
