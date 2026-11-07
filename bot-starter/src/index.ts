// ScrabbleBot bot starter.
//
// First run, with a token from the website:
//   On your team's page, click "Generate token", then run
//   `BOT_NAME=<name> BOT_TOKEN=<token> npm start`.
//
// Or with a nonce from the CLI:
//   1. `spacetime call scrabblebot mint_credential_nonce`
//      `spacetime sql 'SELECT code FROM my_nonces ORDER BY expires_at DESC'`
//   2. `BOT_NAME=<name> BOT_NONCE=<code> npm start`
//      The bot connects fresh and redeems the nonce.
//
// Either way the bot saves its token to .token-<BOT_NAME>, so later runs
// need only `BOT_NAME=<name> npm start`.
//
// Entering a tournament: `BOT_NAME=<name> TOURNAMENT_ID=<id> npm start`
// registers the bot for that tournament when it connects. Only the bot
// itself can register, so this has to come from the bot's process.
//
// Edit ./src/strategy.ts to customise how your bot bids and plays words.

import {
  DbConnection,
  type EventContext,
  type ErrorContext,
} from "./module_bindings/index.js";
import { Identity } from "spacetimedb";
import * as fs from "node:fs";
import * as path from "node:path";
import { Dict, type Rack, rackFromMap, rackToString } from "./engine.js";
import { Brain, DEFAULT_PARAMS, type View } from "./strategy.js";

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const BOT_NAME = process.env.BOT_NAME ?? "bot";
const BOT_TOKEN = process.env.BOT_TOKEN; // from the website, first run only
const BOT_NONCE = process.env.BOT_NONCE; // from the CLI, first run only
const TOURNAMENT_ID = process.env.TOURNAMENT_ID;
const TOKEN_PATH = path.join(process.cwd(), `.token-${BOT_NAME}`);

function loadToken(): string | undefined {
  try {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
function saveToken(tok: string) {
  fs.writeFileSync(TOKEN_PATH, tok);
}

// Word engine + strategy (see strategy.ts). Loading builds an anagram index
// over the ENABLE list (~0.4s).
const DICT = Dict.load();
// Optional live tuning: BRAIN_PARAMS='{"kappa":3.5}' npm start
const PARAMS = { ...DEFAULT_PARAMS, ...JSON.parse(process.env.BRAIN_PARAMS ?? "{}") };
const brain = new Brain(DICT, PARAMS);
console.log(`[${BOT_NAME}] params ${JSON.stringify(PARAMS)}`);
console.log(`[${BOT_NAME}] dictionary: ${DICT.n} anagram classes`);

let myIdentity: Identity | null = null;
let myBotId: bigint | null = null;
// auction id -> amount we last bid (bids can be replaced while open)
const lastBid = new Map<string, number>();
// match id -> word play in flight
const playing = new Set<string>();
const replay = new Set<string>();

function resolveMyBotId(conn: DbConnection): bigint | null {
  if (!myIdentity) return null;
  const cred = conn.db.botCredential.identity.find(myIdentity);
  return cred ? cred.botId : null;
}

function rackForMatch(conn: DbConnection, matchId: bigint): Rack {
  const m = new Map<string, number>();
  for (const h of conn.db.myRack.iter()) {
    if (h.matchId !== matchId) continue;
    m.set(h.letter, (m.get(h.letter) ?? 0) + h.count);
  }
  return rackFromMap(m);
}

function participantForMatch(
  conn: DbConnection,
  matchId: bigint,
): { balance: number; score: number } | null {
  if (myBotId === null) return null;
  for (const p of conn.db.matchParticipant.iter()) {
    if (p.matchId !== matchId) continue;
    if (p.botId !== myBotId) continue;
    return { balance: Number(p.balance), score: Number(p.score) };
  }
  return null;
}

function viewFor(conn: DbConnection, matchId: bigint): View | null {
  const m = conn.db.matchState.id.find(matchId);
  if (!m || m.status.tag !== "Running") return null;
  const part = participantForMatch(conn, matchId);
  if (!part) return null;
  return {
    rack: rackForMatch(conn, matchId),
    balance: part.balance,
    bagLeft: Number(m.bagTotal),
    firstPrice: m.auctionType.tag === "FirstPrice",
  };
}

// A reducer call fails when the module refuses it, often for an expected
// reason: a word played just after its match ended, a bid that missed the
// auction's window. Log it and keep playing; an uncaught failure would stop
// the bot.
function logFailure(what: string) {
  return (err: unknown) =>
    console.warn(
      `[${BOT_NAME}] ${what} failed: ${err instanceof Error ? err.message : err}`,
    );
}

function myRunningMatches(conn: DbConnection): bigint[] {
  if (myBotId === null) return [];
  const out: bigint[] = [];
  for (const p of conn.db.matchParticipant.iter()) {
    if (p.botId !== myBotId) continue;
    const m = conn.db.matchState.id.find(p.matchId);
    if (m?.status.tag === "Running") out.push(p.matchId);
  }
  return out;
}

// Bid (or re-bid, if our valuation moved) on the open auction of a match.
function tryBid(conn: DbConnection, matchId: bigint) {
  if (myBotId === null) return;
  const m = conn.db.matchState.id.find(matchId);
  if (!m || m.status.tag !== "Running" || m.currentAuctionId == null) return;
  const a = conn.db.auction.id.find(m.currentAuctionId);
  if (!a || a.status.tag !== "Open") return;
  const v = viewFor(conn, matchId);
  if (!v) return;
  const t0 = performance.now();
  const letter = a.letter.charCodeAt(0) - 65;
  const amount = brain.bid(v, letter);
  const key = String(a.id);
  const prev = lastBid.get(key);
  if (prev === amount || (prev === undefined && amount <= 0)) return;
  lastBid.set(key, amount);
  conn.reducers
    .submitBid({ auctionId: a.id, amount: BigInt(amount) })
    .catch(logFailure(`bid on auction ${a.id}`));
  console.log(
    `[${BOT_NAME}] m${matchId} '${a.letter}' bid ${amount}${prev !== undefined ? ` (was ${prev})` : ""} ` +
      `bal ${v.balance} bag ${v.bagLeft} rack ${rackToString(v.rack)} (${(performance.now() - t0).toFixed(0)}ms)`,
  );
}

// Play whatever words the strategy wants now, one at a time.
function tryPlayWords(conn: DbConnection, matchId: bigint) {
  const key = String(matchId);
  if (playing.has(key)) {
    replay.add(key);
    return;
  }
  const v = viewFor(conn, matchId);
  if (!v) return;
  const words = brain.words(v).map((k) => DICT.word[k]);
  if (words.length === 0) return;
  playing.add(key);
  // The words are disjoint, so send them all at once: in the end-game flush
  // a round trip per word could miss the last auction's window.
  console.log(`[${BOT_NAME}] m${matchId} playing ${words.join(" ")} (bag ${v.bagLeft})`);
  const sends = words.map((word) =>
    conn.reducers.submitWord({ matchId, word }).catch(logFailure(`playing '${word}'`)),
  );
  // Don't let a lost reply wedge this match.
  const timeout = new Promise((r) => setTimeout(r, 3000));
  Promise.race([Promise.allSettled(sends), timeout]).then(() => {
    playing.delete(key);
    if (replay.delete(key)) tryPlayWords(conn, matchId);
    // Cash went up: our bid on the open auction may want to rise.
    tryBid(conn, matchId);
  });
}

// Re-evaluate everything for every running match. Deferred a tick so the
// client cache holds the whole transaction (rack + new auction) first.
let scheduled = false;
function refresh(conn: DbConnection) {
  if (scheduled) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    for (const matchId of myRunningMatches(conn)) {
      tryPlayWords(conn, matchId);
      tryBid(conn, matchId);
    }
  });
}

function onConnect(conn: DbConnection, identity: Identity, token: string) {
  myIdentity = identity;
  saveToken(token);
  console.log(`[${BOT_NAME}] connected as ${identity.toHexString()}`);

  conn
    .subscriptionBuilder()
    .onApplied(() => {
      console.log(`[${BOT_NAME}] subscription applied`);

      // Resolve our bot id, possibly after claiming a nonce.
      myBotId = resolveMyBotId(conn);
      if (myBotId === null) {
        if (BOT_NONCE) {
          console.log(`[${BOT_NAME}] claiming credential with nonce…`);
          conn.reducers
            .claimCredential({ code: BOT_NONCE })
            .catch(logFailure("claiming the credential"));
          // Wait briefly for the credential to land; check again.
          setTimeout(() => {
            myBotId = resolveMyBotId(conn);
            if (myBotId === null) {
              console.error(
                `[${BOT_NAME}] couldn't claim credential. Bad / expired nonce?`,
              );
              process.exit(1);
            }
            const bot = conn.db.bot.id.find(myBotId);
            console.log(
              `[${BOT_NAME}] claimed credential for bot '${bot?.name ?? "?"}' (id ${myBotId})`,
            );
            bootstrapActivity(conn);
          }, 1000);
          return;
        } else {
          console.error(
            `[${BOT_NAME}] no BotCredential for this token. Set BOT_TOKEN or BOT_NONCE and re-run.`,
          );
          process.exit(1);
        }
      }

      const bot = conn.db.bot.id.find(myBotId);
      console.log(
        `[${BOT_NAME}] acting as bot '${bot?.name ?? "?"}' (id ${myBotId})`,
      );
      bootstrapActivity(conn);
    })
    .subscribeToAllTables();

  conn.db.auction.onInsert(() => refresh(conn));
  conn.db.myRack.onInsert(() => refresh(conn));
  conn.db.myRack.onUpdate(() => refresh(conn));
  conn.db.myRack.onDelete(() => refresh(conn));
  conn.db.matchState.onUpdate(() => refresh(conn));
  conn.db.matchParticipant.onUpdate(() => refresh(conn));
  conn.db.botCredential.onInsert(() => {
    if (myBotId === null) myBotId = resolveMyBotId(conn);
  });
  conn.db.auctionResult.onInsert((_ctx, r) => {
    if (myBotId === null || r.winnerBotId !== myBotId) return;
    console.log(`[${BOT_NAME}] m${r.matchId} won '${r.letter}' for ${r.paid}`);
  });

  // When a match this bot was in ends, hop back into the lobby.
  conn.db.matchState.onUpdate((_ctx, old, neu) => {
    if (myBotId === null) return;
    if (old.status.tag !== "Ended" && neu.status.tag === "Ended") {
      const wasIn = Array.from(conn.db.matchParticipant.iter()).some(
        (p) => p.matchId === neu.id && p.botId === myBotId,
      );
      if (wasIn) {
        const me = participantForMatch(conn, neu.id);
        const all = Array.from(conn.db.matchParticipant.iter())
          .filter((p) => p.matchId === neu.id)
          .map((p) => Number(p.score))
          .sort((a, b) => b - a);
        console.log(
          `[${BOT_NAME}] match ${neu.id} ended: our score ${me?.score} (all: ${all.join(", ")}); rejoining lobby`,
        );
        joinLobby(conn);
      }
    }
  });
}

function joinLobby(conn: DbConnection) {
  if (myBotId === null) return;
  const inRunning = Array.from(conn.db.matchParticipant.iter()).some((p) => {
    if (p.botId !== myBotId) return false;
    const m = conn.db.matchState.id.find(p.matchId);
    return m?.status.tag === "Running";
  });
  if (inRunning) return;
  const openLobby = Array.from(conn.db.lobby.iter()).find(
    (l) => l.status.tag === "Open",
  );
  const alreadyIn =
    openLobby !== undefined &&
    Array.from(conn.db.lobbyMember.iter()).some(
      (lm) => lm.lobbyId === openLobby.id && lm.botId === myBotId,
    );
  if (alreadyIn) return;
  console.log(`[${BOT_NAME}] joining lobby`);
  conn.reducers.joinLobby({}).catch(logFailure("joining the lobby"));
}

function bootstrapActivity(conn: DbConnection) {
  if (TOURNAMENT_ID) {
    conn.reducers
      .registerForTournament({ tournamentId: BigInt(TOURNAMENT_ID) })
      .then(() =>
        console.log(`[${BOT_NAME}] registered for tournament ${TOURNAMENT_ID}`),
      )
      .catch(logFailure(`registering for tournament ${TOURNAMENT_ID}`));
  }
  joinLobby(conn);
  refresh(conn);
}

function main() {
  console.log(`[${BOT_NAME}] connecting to ${DB_NAME} at ${HOST}`);
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(BOT_TOKEN ?? loadToken())
    .onConnect(onConnect)
    .onConnectError((_ctx: ErrorContext, err: Error) =>
      console.error("connect error:", err.message),
    )
    .onDisconnect(() => console.log("disconnected"))
    .build();
}

main();
