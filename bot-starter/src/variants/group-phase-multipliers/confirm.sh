#!/bin/bash
# Out-of-sample confirmation of one multiplier table: test seed 11, test seed 23
# (replay_hack.json, REPLAY_SEEDS=4) and the strong pool (replay_data.json,
# REPLAY_MIN_ID=42600 REPLAY_REAL=1, 97 matches x4 seeds). 3 processes at once.
#   usage: confirm.sh '<json over>' <tag>      -> confirm_<tag>.txt next to this script
cd /home/user/scrabblebot/bot-starter || exit 1
J="$1"; TAG="${2:-run}"
D=src/variants/group-phase-multipliers
OUT=$D/confirm_$TAG.txt
P=./variants/group-phase-multipliers/policy.ts
T=./node_modules/.bin/tsx
echo "=== confirm $TAG $(date -u) over=$J" > "$OUT"
( QUIET=1 REPLAY_FILE=./replay_hack.json REPLAY_SPLIT=test REPLAY_SEEDS=4 REPLAY_POLICY=$P $T src/replay.ts x 200 11 "$J" 2>&1 | sed 's/^/test seed 11: /' ) > "$OUT.11" &
( QUIET=1 REPLAY_FILE=./replay_hack.json REPLAY_SPLIT=test REPLAY_SEEDS=4 REPLAY_POLICY=$P $T src/replay.ts x 200 23 "$J" 2>&1 | sed 's/^/test seed 23: /' ) > "$OUT.23" &
( QUIET=1 REPLAY_FILE=./replay_data.json REPLAY_SPLIT= REPLAY_MIN_ID=42600 REPLAY_REAL=1 REPLAY_SEEDS=4 REPLAY_POLICY=$P $T src/replay.ts x 97 11 "$J" 2>&1 | sed 's/^/strong pool: /' ) > "$OUT.strong" &
wait
cat "$OUT.11" "$OUT.23" "$OUT.strong" >> "$OUT"
rm -f "$OUT.11" "$OUT.23" "$OUT.strong"
echo "=== done $(date -u)" >> "$OUT"
cat "$OUT"
