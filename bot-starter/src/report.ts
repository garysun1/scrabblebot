// Live results for a bot from the public tables. No token needed.
//   npx tsx src/report.ts <botId> [lastN=15]
const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB = process.env.STDB_DB ?? "scrabblebot";
const botId = Number(process.argv[2] ?? 178);
const lastN = Number(process.argv[3] ?? 15);

async function main() {
  const { token } = (await (await fetch(`${HOST}/v1/identity`, { method: "POST" })).json()) as { token: string };
  const sql = async (q: string): Promise<any[][]> => {
    const r = await fetch(`${HOST}/v1/database/${DB}/sql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: q,
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return ((await r.json()) as any[])[0].rows;
  };
  const mine = (await sql(`SELECT match_id FROM match_participant WHERE bot_id = ${botId}`))
    .map((r) => Number(r[0]))
    .sort((a, b) => a - b)
    .slice(-lastN);
  if (mine.length === 0) return console.log("no matches yet");
  let places = 0, n = 0, wins = 0;
  for (const m of mine) {
    const st = (await sql(`SELECT status FROM match_state WHERE id = ${m}`))[0]?.[0];
    const ended = Array.isArray(st) && st[0] === 2;
    const ps = await sql(`SELECT bot_id, score, balance FROM match_participant WHERE match_id = ${m}`);
    const res = await sql(`SELECT winner_bot_id, paid FROM auction_result WHERE match_id = ${m}`);
    const me = ps.find((p) => Number(p[0]) === botId)!;
    const place = 1 + ps.filter((p) => Number(p[1]) > Number(me[1])).length;
    const won = res.filter((r) => r[0][0] === 0 && Number(r[0][1]) === botId);
    const spent = won.reduce((a, r) => a + Number(r[1]), 0);
    const scores = ps.map((p) => Number(p[1])).sort((a, b) => b - a).join("/");
    console.log(
      `match ${m}${ended ? "" : " (running)"}: place ${place}/${ps.length} score ${me[1]} bal ${me[2]} ` +
        `letters ${won.length} avg price ${won.length ? (spent / won.length).toFixed(1) : "-"}  [${scores}]`,
    );
    if (ended) { places += place; n++; if (place === 1) wins++; }
  }
  if (n) console.log(`finished ${n}: avg place ${(places / n).toFixed(2)}, wins ${wins}`);
}
main();
