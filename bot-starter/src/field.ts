// Brain variants vs a table of live-field-like bots.
// npx tsx src/field.ts N '[{"name":"a",...}]' [fieldCount] [seed]
import { Dict } from "./engine.js";
import { DEFAULT_PARAMS } from "./strategy.js";
import { brainBot, evaluate, fieldBot, type Game } from "./sim.js";
const d = Dict.load();
const N = Number(process.argv[2] ?? 40);
const vs: any[] = JSON.parse(process.argv[3]);
const nf = Number(process.argv[4] ?? 5);
for (const v of vs) {
  const mix = (g: Game) => [brainBot(g, { ...DEFAULT_PARAMS, ...v }, "brain"),
    ...Array.from({ length: nf }, (_, i) => fieldBot(g, [1, 0.9, 1.1, 1, 1.2][i % 5], `f${i}`))];
  const r = evaluate(d, mix, N, Number(process.argv[5] ?? 3));
  const f = Object.entries(r).filter(([k]) => k !== "brain").map(([, x]) => x.score);
  console.log(JSON.stringify(v).padEnd(60), "brain", r.brain, "field avg", (f.reduce((a, b) => a + b, 0) / f.length).toFixed(1));
}
