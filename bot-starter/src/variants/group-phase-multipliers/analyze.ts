// Reads cem.log, fits avg place ~ b0 + sum_k b_k * (M_k - 1) over every evaluated
// candidate (OLS via normal equations), prints coefficients with standard errors,
// the best candidates, and the baseline line.
//   ./node_modules/.bin/tsx src/variants/group-phase-multipliers/analyze.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KEYS = ["v", "c1", "c24", "c5"].flatMap((g) => ["e", "m", "l"].map((p) => `${g}_${p}`));
const log = readFileSync(fileURLToPath(new URL("./cem.log", import.meta.url)), "utf8").split("\n");
const rows: { x: number[]; y: number; raw: string }[] = [];
for (const line of log) {
  const m = line.match(/cand \d+: policy:\S+ (\{.*?\}) n=(\d+): avg place ([\d.]+)/);
  if (!m) continue;
  const over = JSON.parse(m[1]) as Record<string, number>;
  rows.push({ x: KEYS.map((k) => (over[k] ?? 1) - 1), y: Number(m[3]), raw: line.trim() });
}
console.log(`candidates: ${rows.length}`);
for (const l of log) if (/baseline|FINAL|BEST/.test(l)) console.log(l.trim());
if (rows.length < KEYS.length + 3) {
  console.log("too few candidates for a 12-parameter fit; per-key correlations instead:");
}
// OLS with intercept
const n = rows.length, p = KEYS.length + 1;
const X = rows.map((r) => [1, ...r.x]);
const y = rows.map((r) => r.y);
function solve(A: number[][], b: number[]): number[] | null {
  const m = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[m] / row[i]);
}
if (n >= p + 2) {
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[i] * r[j], 0)));
  const Xty = Array.from({ length: p }, (_, i) => X.reduce((a, r, t) => a + r[i] * y[t], 0));
  const beta = solve(XtX, Xty);
  if (beta) {
    const resid = y.map((v, t) => v - X[t].reduce((a, xi, i) => a + xi * beta[i], 0));
    const s2 = resid.reduce((a, b) => a + b * b, 0) / (n - p);
    // (XtX)^-1 diagonal via solving for unit vectors
    const se = Array.from({ length: p }, (_, i) => {
      const e = Array.from({ length: p }, (_, j) => (i === j ? 1 : 0));
      const col = solve(XtX, e);
      return col ? Math.sqrt(Math.max(0, s2 * col[i])) : NaN;
    });
    console.log(`OLS avg place on (M-1): intercept ${beta[0].toFixed(3)} resid sd ${Math.sqrt(s2).toFixed(3)}`);
    console.log("  key     coef (place per +1.0 mult)   se      t   -> sign<0 means raising this multiplier helps");
    KEYS.forEach((k, i) => console.log(`  ${k.padEnd(6)} ${beta[i + 1].toFixed(3).padStart(8)}  ${se[i + 1].toFixed(3).padStart(8)}  ${(beta[i + 1] / se[i + 1]).toFixed(2).padStart(6)}`));
  }
}
// simple per-key correlation as a robustness check
console.log("per-key correlation of avg place with each multiplier (negative = higher mult, better place):");
KEYS.forEach((k, i) => {
  const xs = rows.map((r) => r.x[i]);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let t = 0; t < n; t++) { sxy += (xs[t] - mx) * (y[t] - my); sxx += (xs[t] - mx) ** 2; syy += (y[t] - my) ** 2; }
  console.log(`  ${k.padEnd(6)} r=${(sxy / Math.sqrt(sxx * syy || 1)).toFixed(2)}`);
});
console.log("best 5 candidates:");
const sorted = [...rows].sort((a, b) => a.y - b.y);
for (const r of sorted.slice(0, 5)) console.log("  " + r.raw);
// Elite mean over ALL evaluated candidates (what the CEM would adopt from this pool).
const E = Number(process.env.ELITE ?? 3);
const el = sorted.slice(0, E);
const eliteMean = Object.fromEntries(KEYS.map((k, i) => [k, +(1 + el.reduce((a, r) => a + r.x[i], 0) / el.length).toFixed(3)]));
console.log(`elite-${E} mean table (scores ${el.map((r) => r.y).join(", ")}): ${JSON.stringify(eliteMean)}`);
