#!/usr/bin/env python3 -I
"""Build the leaders' winning-bid table (letter x phase x holds-letter) from the
archive JSONL in the scratchpad.  Output: leaders.json next to this script.

Usage: python3 -I analyze_leaders.py <scratchpad_dir> <out.json>
"""
import json, sys, os
from collections import defaultdict

D = sys.argv[1]
OUT = sys.argv[2]
LEADERS = {171: "GodOfThudner", 193: "RackMaw", 201: "Lbender", 207: "LexForge-1107"}
L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
VOW = set("AEIOU")
FACE = dict(zip(L, [1,3,3,2,1,4,2,4,1,8,5,1,3,1,1,3,10,1,1,1,1,4,4,8,4,10]))

def group(c):
    if c in VOW: return "vowel"
    f = FACE[c]
    if f == 1: return "cons1"
    if f <= 4: return "cons2-4"
    return "prem5+"

def load(name):
    p = os.path.join(D, name)
    if not os.path.exists(p): return []
    with open(p) as f:
        return [json.loads(l) for l in f if l.strip()]

ar = load("x_ar.jsonl") + load("w_ar.jsonl")
tb = {}
for a, b in load("x_tb.jsonl") + load("w_tb.jsonl"):
    tb[a] = b
mp = load("x_mp.jsonl") + load("w_mp.jsonl")
wp = load("x_wp.jsonl") + load("y_wp.jsonl") + load("z_wp.jsonl")

# matches -> seated bots
seats = defaultdict(set)
for row in mp:
    seats[row[0]].add(row[1])

# auctions per match sorted by time
auc = defaultdict(list)
for row in ar:
    aid, mid, letter, win, paid, ts = row[0], row[1], row[2], row[3], row[4], row[5][0]
    wid = None
    if isinstance(win, list) and len(win) >= 2:
        wid = win[1] if isinstance(win[1], int) else None  # [1, []] = nobody bid
    elif isinstance(win, int):
        wid = win
    auc[mid].append((ts, aid, letter, wid, paid))
for m in auc: auc[m].sort()

plays = defaultdict(list)  # (match, bot) -> [(ts, word)]
seen_play = set()
for row in wp:
    key = (row[0], row[1], row[2], row[4][0])
    if key in seen_play: continue
    seen_play.add(key)
    plays[(row[0], row[1])].append((row[4][0], row[2]))
for k in plays: plays[k].sort()

def phase_of(idx, n):
    return min(2, (idx * 3) // max(1, n))

# cells[letter][phase][hold] -> list of top bids (winner's sealed bid), paid
cell_bids = defaultdict(list)
cell_paid = defaultdict(list)
cell_opp = defaultdict(int)   # auctions of this cell faced by a seated leader
cell_win = defaultdict(int)
mix_lead = defaultdict(lambda: defaultdict(int))   # phase -> group -> count
all_mix = defaultdict(lambda: defaultdict(int))    # everyone else, for reference
n_lead_matches = 0
n_matches_with_tb = 0
for mid, rows in auc.items():
    n = len(rows)
    leaders_here = [b for b in seats.get(mid, ()) if b in LEADERS]
    # also catch leaders that won something even if mp missing
    for r in rows:
        if r[3] in LEADERS and r[3] not in leaders_here: leaders_here.append(r[3])
    if any(r[1] in tb for r in rows): n_matches_with_tb += 1
    for i, (ts, aid, letter, wid, paid) in enumerate(rows):
        ph = phase_of(i, n)
        if wid is not None and wid not in LEADERS:
            all_mix[ph][group(letter)] += 1
    for b in leaders_here:
        n_lead_matches += 1
        vis = defaultdict(int)
        pl = plays.get((mid, b), [])
        pi = 0
        for i, (ts, aid, letter, wid, paid) in enumerate(rows):
            # apply plays that happened before this auction closed
            while pi < len(pl) and pl[pi][0] < ts:
                for c in pl[pi][1]:
                    if vis[c] > 0: vis[c] -= 1
                pi += 1
            ph = phase_of(i, n)
            hold = 1 if vis[letter] > 0 else 0
            key = (letter, ph, hold)
            cell_opp[key] += 1
            if wid == b:
                cell_win[key] += 1
                mix_lead[ph][group(letter)] += 1
                if aid in tb and tb[aid] is not None and tb[aid] > 0:
                    cell_bids[key].append(tb[aid])
                cell_paid[key].append(paid)
                vis[letter] += 1

def q(xs, p):
    if not xs: return None
    s = sorted(xs)
    k = (len(s) - 1) * p
    lo = int(k); hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)

def stats(xs):
    if not xs: return None
    return {"n": len(xs), "q50": q(xs, .5), "q60": q(xs, .6), "q75": q(xs, .75), "q90": q(xs, .9),
            "mean": sum(xs) / len(xs)}

MIN_N = 8
table = {}   # letter -> phase -> hold -> stats (with fallback) ; plus winrate
for c in L:
    table[c] = []
    for ph in range(3):
        row = []
        for hold in (0, 1):
            xs = cell_bids[(c, ph, hold)]
            src = "cell"
            if len(xs) < MIN_N:
                xs = cell_bids[(c, ph, 0)] + cell_bids[(c, ph, 1)]; src = "phase"
            if len(xs) < MIN_N:
                xs = [x for p2 in range(3) for h2 in (0, 1) for x in cell_bids[(c, p2, h2)]]; src = "letter"
            st = stats(xs) or {"n": 0, "q50": 10, "q60": 11, "q75": 13, "q90": 18, "mean": 10}
            st["src"] = src
            st["nCell"] = len(cell_bids[(c, ph, hold)])
            opp = cell_opp[(c, ph, hold)]
            st["opp"] = opp
            st["wins"] = cell_win[(c, ph, hold)]
            st["winrate"] = (cell_win[(c, ph, hold)] / opp) if opp else None
            row.append(st)
        table[c].append(row)

def shares(mix):
    out = {}
    for ph in range(3):
        tot = sum(mix[ph].values()) or 1
        out[ph] = {g: round(mix[ph][g] / tot, 3) for g in ("vowel", "cons1", "cons2-4", "prem5+")}
        out[ph]["n"] = tot
    return out

res = {
    "leaders": LEADERS,
    "nLeaderMatchSeats": n_lead_matches,
    "nMatches": len(auc),
    "nMatchesWithTopBids": n_matches_with_tb,
    "phaseDef": "auctionIndex*3//totalAuctions: 0=early,1=mid,2=late",
    "table": table,
    "mixLeaders": shares(mix_lead),
    "mixOthers": shares(all_mix),
}
with open(OUT, "w") as f:
    json.dump(res, f)

# compact TS-friendly arrays: Q[letter][phase][hold] = [q50,q60,q75,q90]
Q = [[[[table[c][ph][h][k] for k in ("q50", "q60", "q75", "q90")] for h in (0, 1)] for ph in range(3)] for c in L]
with open(OUT.replace(".json", "_q.json"), "w") as f:
    json.dump({"Q": Q}, f)

# report
print("leader seats:", n_lead_matches, "matches:", len(auc), "with top bids:", n_matches_with_tb)
print("letter ph hold | n(cell) q50 q60 q75 q90 | winrate wins/opp")
for c in L:
    for ph in range(3):
        for h in (0, 1):
            st = table[c][ph][h]
            wr = "%.2f" % st["winrate"] if st["winrate"] is not None else " -- "
            print(f"{c} {ph} {h} | {st['nCell']:4d} {st['q50']:5.1f} {st['q60']:5.1f} {st['q75']:5.1f} {st['q90']:5.1f} [{st['src'][0]}] | {wr} {st['wins']}/{st['opp']}")
print("mix leaders:", json.dumps(res["mixLeaders"]))
print("mix others :", json.dumps(res["mixOthers"]))
