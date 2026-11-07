// Random-pool evaluation: each match seats 6 bots drawn from a mixed population
// (brain variants + rivals + starters + house sims). Reports avg place per bot.
// npx tsx src/pool.ts N '[{"name":"a",...params}]' seed
import { Dict } from "./engine.js";
import { DEFAULT_PARAMS } from "./strategy.js";
import { Game, brainBot, greedyBot, simBot, starterBot, type Player } from "./sim.js";

const d = Dict.load();
const N = Number(process.argv[2] ?? 100);
const variants: any[] = JSON.parse(process.argv[3]);
let s = Number(process.argv[4] ?? 5);
const rnd = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const g = new Game(d, rnd);
type Mk = () => Player;
const pool: Mk[] = [
  ...variants.map((v) => () => brainBot(g, { ...DEFAULT_PARAMS, ...v }, v.name)),
  () => greedyBot(g, 2, "g2"), () => greedyBot(g, 3, "g3"), () => greedyBot(g, 4, "g4"), () => greedyBot(g, 5, "g5"),
  () => starterBot(g, "starter"), () => starterBot(g, "starter"),
  () => simBot(g, "aggr", "sim"), () => simBot(g, "value", "sim"),
];
const st = new Map<string, { n: number; place: number; score: number; win: number }>();
for (let m = 0; m < N; m++) {
  const idx = pool.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, 6);
  const ps = idx.map((i) => pool[i]());
  const sc = g.run(ps);
  ps.forEach((p, i) => {
    const e = st.get(p.name) ?? { n: 0, place: 0, score: 0, win: 0 };
    const better = sc.filter((x) => x > sc[i]).length;
    e.n++; e.place += better + 1; e.score += sc[i]; if (!better) e.win++;
    st.set(p.name, e);
  });
}
for (const [k, e] of [...st].sort((a, b) => a[1].place / a[1].n - b[1].place / b[1].n))
  console.log(k.padEnd(8), "n", String(e.n).padStart(4), "place", (e.place / e.n).toFixed(2), "score", (e.score / e.n).toFixed(1), "win", (e.win / e.n).toFixed(2));
