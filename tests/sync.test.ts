// The synchronization contract: one snapshot, then numbered updates, with the server as the only source of truth.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Socket } from "socket.io-client";
import { DEFAULT_EVENTS } from "../config/events";
import type { SeasonalEvent } from "../shared/events";
import type { FloatingKrathong } from "../shared/interactions";
import type { ChatMessage, MusicState, RoomState } from "../shared/protocol";
import { classifyVersion, clockOffset, newer } from "../shared/sync";
import { ask, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
const roomy = { limit: 1000, windowMs: 1000 };
const open = { musicToggle: roomy, musicStation: roomy, musicNext: roomy, sticker: roomy, stickerSlow: roomy, krathongPickup: roomy };
const start = async (overrides: Parameters<typeof startServer>[0] = {}, extras: Parameters<typeof startServer>[2] = {}, limits: Parameters<typeof startServer>[1] = open) =>
  (server = await startServer({ musicSharedCooldownMs: 0, ...overrides }, limits, extras));
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

/** Records every numbered update a socket receives, in order. */
const record = (socket: Socket) => {
  const seen: { event: string; roomVersion: number; serverTime: number }[] = [];
  socket.onAny((event: string, payload: { roomVersion?: number; serverTime?: number }) => {
    if (typeof payload?.roomVersion === "number") seen.push({ event, roomVersion: payload.roomVersion, serverTime: payload.serverTime! });
  });
  return seen;
};
const resync = async (socket: Socket, roomCode: string) => {
  const fresh = once<RoomState>(socket, "room:snapshot");
  assert.equal(errorCode(await ask(socket, "room:resync", { roomCode, reason: "MANUAL" })), "OK");
  return fresh;
};
const uuid = () => crypto.randomUUID();

// --- The client's rules ---------------------------------------------------------------

test("a client applies the next version, ignores old ones, and treats a jump as a gap", () => {
  assert.equal(classifyVersion(120, 121), "apply");
  assert.equal(classifyVersion(120, 120), "ignore"); // a duplicate
  assert.equal(classifyVersion(120, 117), "ignore"); // arrived late
  assert.equal(classifyVersion(120, 122), "gap"); // 121 was missed: ask for a snapshot
  assert.equal(classifyVersion(null, 5), "ignore"); // nothing to compare with until the first snapshot
});

test("state with its own version keeps whichever is newer, whatever order it arrives in", () => {
  const v13 = { version: 13, playing: false };
  const v14 = { version: 14, playing: true };
  assert.equal(newer(v13, v14), v14);
  assert.equal(newer(v14, v13), v14); // version 13 arriving after 14 is ignored
  assert.equal(clockOffset(10_500, 10_000), 500);
});

// --- Snapshot ---------------------------------------------------------------------------

test("a new user receives the complete room state, with no private data", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const state = bow.state;

  for (const field of ["roomId", "code", "createdAt", "version", "versions", "selfId", "ownerUserId", "scene", "users", "music", "musicSettings", "stations", "event", "inventory", "krathongs", "serverTime"]) {
    assert.ok(field in state, field);
  }
  assert.deepEqual(Object.keys(state.versions).sort(), ["event", "interactions", "krathongs", "music", "room", "users"]);
  assert.equal(state.versions.room, state.version);
  assert.equal(state.versions.music, state.music.version);
  assert.ok(Math.abs(state.serverTime - Date.now()) < 2000);
  const me = state.users.find((user) => user.id === bow.userId)!;
  assert.deepEqual([me.connected, typeof me.joinedAt, me.displayName], [true, "number", "Bow"]);

  // Nothing about sessions, cookies or connections is in it.
  const text = JSON.stringify(state);
  for (const secret of ["socketId", "sessionId", "duck_session", "leaveTimer", bow.cookie.split("=")[1].split(".").at(-1)!]) assert.ok(!text.includes(secret), secret);
});

test("two users see the same room", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await ask(sam.socket, "duck:move", { destination: { x: 0.3, y: 0.3 } });
  await ask(bow.socket, "duck:move", { destination: { x: 0.7, y: 0.6 } });
  await ask(sam.socket, "music:play");

  const [a, b] = [await resync(sam.socket, sam.code), await resync(bow.socket, bow.code)];
  const shared = ({ selfId: _selfId, inventory: _inventory, serverTime: _serverTime, ...rest }: RoomState) => rest;
  assert.deepEqual(shared(a), shared(b));
  assert.deepEqual(a.users.map((user) => [user.displayName, user.x, user.y]), [["Sam", 0.3, 0.3], ["Bow", 0.7, 0.6]]);
});

// --- Numbered updates ------------------------------------------------------------------

test("every shared change is the next room version, with the server's time", async () => {
  const festival: SeasonalEvent = { ...DEFAULT_EVENTS.find((event) => event.slug === "loy-krathong")!, startAt: new Date(Date.now() - 3_600_000).toISOString(), endAt: new Date(Date.now() + 3_600_000).toISOString() };
  const { duck } = await start({}, { events: [festival] });
  const sam = await duck();
  const seen = record(sam.socket);
  const bow = await duck(sam.code, "Bow");

  await ask(sam.socket, "duck:move", { destination: { x: 0.45, y: 0.05 } });
  await ask(sam.socket, "chat:message", { text: "hello" });
  await ask(sam.socket, "music:play");
  await ask(sam.socket, "music:permission:setMode", { mode: "DJ_ONLY" });
  await ask(sam.socket, "music:permission:addDJ", { targetUserId: bow.userId });
  await ask(bow.socket, "music:next");
  await ask(sam.socket, "duck:item", { heldItem: "sword" });
  await ask(sam.socket, "cosmetic:equip", { slot: "head", wearableId: "blue-cap" });
  await ask(sam.socket, "sticker:send", { stickerId: "heart" });
  await ask(sam.socket, "krathong:pickup", { stallId: "krathong-stall-01", variant: "lotus-pink" });
  await ask(sam.socket, "duck:move", { destination: { x: 0.5, y: 0.85 } });
  await ask(sam.socket, "krathong:release", { zoneId: "river-release-01" });
  await ask(sam.socket, "room:scene", { scene: "festival" });
  await wait(80);

  const versions = seen.map((update) => update.roomVersion);
  assert.ok(versions.length >= 16, `only ${versions.length} updates`);
  assert.deepEqual(versions, versions.map((_, i) => sam.state.version + 1 + i), "consecutive, starting right after the snapshot");
  assert.ok(seen.every((update) => Math.abs(update.serverTime - Date.now()) < 5000));
  for (const kind of ["room:userJoined", "duck:moved", "chat:message", "music:state", "music:permissions", "duck:item", "duck:appearance", "sticker:sent", "duck:stateChanged", "krathong:spawned", "room:settingsChanged"]) {
    assert.ok(seen.some((update) => update.event === kind), kind);
  }
});

test("a newcomer's first update is exactly one version after their snapshot", async () => {
  const { duck } = await start();
  const sam = await duck();
  await ask(sam.socket, "chat:message", { text: "before Bow" });
  const bow = await duck(sam.code, "Bow");
  const seen = record(bow.socket);
  await ask(sam.socket, "chat:message", { text: "after Bow" });
  await wait(50);
  assert.equal(seen[0].roomVersion, bow.state.version + 1);
  // Everything up to the snapshot, including the newcomer's own arrival, is already inside it.
  assert.ok(bow.state.messages.some((message) => message.text === "before Bow"));
  assert.ok(bow.state.messages.some((message) => message.text.includes("Bow waddled in")));
});

test("full snapshots are sent on join and on request only, never during normal play", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  let snapshots = 0;
  sam.socket.on("room:snapshot", () => snapshots++);
  bow.socket.on("room:snapshot", () => snapshots++);
  for (let i = 0; i < 10; i++) await ask(sam.socket, "duck:move", { destination: { x: 0.1 + i * 0.05, y: 0.5 } });
  await ask(bow.socket, "chat:message", { text: "hi" });
  await ask(sam.socket, "music:play");
  await wait(60);
  assert.equal(snapshots, 0);
});

test("asking for a resync returns the current state; asking too often is refused", async () => {
  const { duck, visitor, connect } = await start({}, {}, {});
  const sam = await duck();
  await ask(sam.socket, "chat:message", { text: "one" });
  await ask(sam.socket, "chat:message", { text: "two" });
  const history = once<{ messages: ChatMessage[] }>(sam.socket, "chat:history");
  const fresh = await resync(sam.socket, sam.code);
  assert.equal(fresh.version, sam.state.version + 2);
  assert.equal((await history).messages.at(-1)?.text, "two");

  const results = [];
  for (let i = 0; i < 6; i++) results.push(errorCode(await ask(sam.socket, "room:resync", { roomCode: sam.code, reason: "VERSION_GAP" })));
  // Five in ten seconds: the one above, four more, and then no.
  assert.deepEqual(results, ["OK", "OK", "OK", "OK", "RATE_LIMITED", "RATE_LIMITED"]);
  // Someone outside the room gets nothing.
  assert.equal(errorCode(await ask(await connect((await visitor()).cookie), "room:resync", { roomCode: sam.code, reason: "MANUAL" })), "NOT_IN_ROOM");
});

// --- Movement ---------------------------------------------------------------------------

test("a move is shared as a destination and a duration, and the server's answer is what counts", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const moved = once<{ userId: string; from: { x: number; y: number }; destination: { x: number; y: number }; direction: string; startedAt: number; durationMs: number; serverMoveId: string; clientMoveId?: string; usersVersion: number }>(bow.socket, "duck:moved");
  const clientMoveId = uuid();
  const answer = await ask(sam.socket, "duck:move", { clientMoveId, destination: { x: 1, y: 0.5 } });
  const move = await moved;
  assert.equal(move.userId, sam.userId);
  assert.equal(move.destination.x, 0.96); // the server keeps ducks inside the room, whatever was asked for
  assert.equal(move.direction, "right");
  assert.deepEqual(move.from, { x: sam.state.users[0].x, y: sam.state.users[0].y });
  assert.equal(move.clientMoveId, clientMoveId);
  assert.deepEqual(answer.ok && answer.data, { serverMoveId: move.serverMoveId });
  assert.match(move.serverMoveId, /^[0-9a-f-]{36}$/);
  assert.ok(move.durationMs >= 350 && Math.abs(move.startedAt - Date.now()) < 2000);

  // The destination everyone has is the server's, not the one the client predicted.
  const state = await resync(sam.socket, sam.code);
  assert.equal(state.users.find((user) => user.id === sam.userId)?.x, 0.96);
});

test("a move the server refuses leaves the duck where the server has it", async () => {
  const { duck } = await start({ stickers: { matchWindowMs: 3000, pairCooldownMs: 0, startDelayMs: 10 } });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await ask(sam.socket, "duck:move", { destination: { x: 0.2, y: 0.2 } });
  await ask(bow.socket, "duck:move", { destination: { x: 0.8, y: 0.8 } });
  await ask(sam.socket, "sticker:send", { stickerId: "heart" });
  await ask(bow.socket, "sticker:send", { stickerId: "heart" }); // both ducks are now busy

  assert.equal(errorCode(await ask(sam.socket, "duck:move", { destination: { x: 0.5, y: 0.5 } })), "INVALID_STATE");
  const state = await resync(bow.socket, bow.code);
  assert.deepEqual([state.users.find((user) => user.id === sam.userId)?.x, state.users.find((user) => user.id === sam.userId)?.y], [0.2, 0.2]);
});

// --- Music and events: their own versions -----------------------------------------------

test("music has its own version, which goes up by one for each accepted command", async () => {
  const { duck } = await start();
  const sam = await duck();
  const states: MusicState[] = [];
  sam.socket.on("music:state", ({ state }: { state: MusicState }) => states.push(state));
  await ask(sam.socket, "music:play");
  await ask(sam.socket, "music:next");
  await ask(sam.socket, "music:pause");
  await wait(50);
  assert.deepEqual(states.map((state) => state.version), [2, 3, 4].map((n) => sam.state.music.version + n - 1));
  assert.deepEqual(states.map((state) => state.changedByUserId), [sam.userId, sam.userId, sam.userId]);
});

test("an event change reaches everyone without reconnecting, and the snapshot agrees", async () => {
  const soon: SeasonalEvent = { ...DEFAULT_EVENTS.find((event) => event.slug === "sakura-festival")!, startAt: new Date(Date.now() + 3_600_000).toISOString(), endAt: new Date(Date.now() + 7_200_000).toISOString() };
  const s = await start({}, { events: [soon] });
  const sam = await s.duck();
  let disconnects = 0;
  sam.socket.on("disconnect", () => disconnects++);

  const changed = once<{ state: { version: number; slug: string } }>(sam.socket, "event:state");
  s.clock.now = Date.now() + 1.5 * 3_600_000;
  s.events.tick();
  const { state } = await changed;
  assert.equal(state.slug, "sakura-festival");
  assert.ok(state.version > sam.state.event.state.version);

  const fresh = await resync(sam.socket, sam.code);
  assert.equal(fresh.versions.event, state.version);
  assert.equal(fresh.event.event?.slug, "sakura-festival");
  assert.equal(disconnects, 0);
});

// --- Presence and reconnecting -------------------------------------------------------------

test("a dropped connection keeps the duck in the room; coming back does not make a second one", async () => {
  const { duck, connect } = await start({ presenceGraceMs: 400 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await ask(bow.socket, "duck:move", { destination: { x: 0.25, y: 0.75 } });
  const seen = record(sam.socket);
  const chat: string[] = [];
  sam.socket.on("chat:message", ({ message }: { message: ChatMessage }) => chat.push(message.text));

  const away = once<{ userId: string; connected: boolean }>(sam.socket, "room:presence");
  bow.socket.disconnect();
  assert.deepEqual([(await away).userId, (await away).connected], [bow.userId, false]);
  let state = await resync(sam.socket, sam.code);
  assert.deepEqual(state.users.map((user) => [user.displayName, user.connected]), [["Sam", true], ["Bow", false]]);

  const back = once<{ user: { id: string; connected: boolean; x: number; y: number; joinedAt: number } }>(sam.socket, "room:userJoined").then((update) => update.user);
  const again = await connect(bow.cookie);
  const snapshot = once<RoomState>(again, "room:snapshot");
  await ask(again, "room:join", { roomCode: sam.code, displayName: "Bow", duckColor: "yellow" });
  const returned = await back;
  assert.deepEqual([returned.id, returned.connected, returned.x, returned.y], [bow.userId, true, 0.25, 0.75]);
  assert.equal(returned.joinedAt, bow.state.users.find((user) => user.id === bow.userId)?.joinedAt);

  state = await snapshot;
  assert.equal(state.users.length, 2, "still two ducks");
  assert.deepEqual(chat, [], "no 'waddled away' and no second 'waddled in'");
  await wait(500); // the old grace timer must not remove the duck that came back
  assert.equal((await resync(sam.socket, sam.code)).users.length, 2);
  // And all of it arrived as ordinary numbered updates.
  assert.deepEqual(seen.map((update) => update.roomVersion), seen.map((_, i) => seen[0].roomVersion + i));
});

test("a duck that does not come back is removed after the grace period", async () => {
  const { duck } = await start({ presenceGraceMs: 120 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const left = once<{ userId: string }>(sam.socket, "room:userLeft");
  bow.socket.disconnect();
  assert.equal((await left).userId, bow.userId);
  assert.equal((await resync(sam.socket, sam.code)).users.length, 1);
});

test("pressing Exit leaves at once, grace period or not", async () => {
  const { duck } = await start({ presenceGraceMs: 60_000 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const left = once<{ userId: string }>(sam.socket, "room:userLeft");
  assert.equal(errorCode(await ask(bow.socket, "room:leave")), "OK");
  assert.equal((await left).userId, bow.userId);
});

test("an owner who is away, but still held in the room, loses the room after the owner grace period", async () => {
  const { duck } = await start({ presenceGraceMs: 60_000, ownerGraceMs: 80 });
  const owner = await duck();
  const bow = await duck(owner.code, "Bow");
  const changed = once<{ ownerUserId: string }>(bow.socket, "room:ownerChanged");
  owner.socket.disconnect();
  assert.equal((await changed).ownerUserId, bow.userId);
  const state = await resync(bow.socket, bow.code);
  assert.deepEqual(state.users.map((user) => [user.displayName, user.connected]), [["Sam", false], ["Bow", true]]);
});

// --- Commands that are safe to repeat -----------------------------------------------------

test("repeating a command with the same id does not repeat its effect", async () => {
  const festival: SeasonalEvent = { ...DEFAULT_EVENTS.find((event) => event.slug === "loy-krathong")!, startAt: new Date(Date.now() - 3_600_000).toISOString(), endAt: new Date(Date.now() + 3_600_000).toISOString() };
  const { duck, url } = await start({}, { events: [festival] });
  const sam = await duck();
  const spawned: FloatingKrathong[] = [];
  const music: MusicState[] = [];
  const chat: ChatMessage[] = [];
  sam.socket.on("krathong:spawned", ({ krathong }: { krathong: FloatingKrathong }) => spawned.push(krathong));
  sam.socket.on("music:state", ({ state }: { state: MusicState }) => music.push(state));
  const chatIds: (string | undefined)[] = [];
  sam.socket.on("chat:message", ({ message, clientMessageId }: { message: ChatMessage; clientMessageId?: string }) => message.type === "user" && (chat.push(message), chatIds.push(clientMessageId)));

  // Floating a krathong
  await ask(sam.socket, "duck:move", { destination: { x: 0.45, y: 0.05 } });
  await ask(sam.socket, "krathong:pickup", { stallId: "krathong-stall-01", variant: "lotus-pink" });
  await ask(sam.socket, "duck:move", { destination: { x: 0.5, y: 0.85 } });
  const release = { zoneId: "river-release-01", commandId: uuid() };
  const first = await ask(sam.socket, "krathong:release", release);
  const retry = await ask(sam.socket, "krathong:release", release);
  assert.ok(first.ok && first.data?.krathongId);
  assert.deepEqual(retry, first, "the retry gets the first answer again");

  // Skipping a station, and choosing one
  const next = { commandId: uuid() };
  await ask(sam.socket, "music:next", next);
  await ask(sam.socket, "music:next", next);
  const station = { stationId: "rain", commandId: uuid() };
  await ask(sam.socket, "music:station", station);
  await ask(sam.socket, "music:station", station);

  // A chat message
  const message = { text: "only once", clientMessageId: uuid() };
  await ask(sam.socket, "chat:message", message);
  await ask(sam.socket, "chat:message", message);
  await wait(80);

  assert.equal(spawned.length, 1, "one krathong");
  assert.equal(music.length, 2, "one skip and one station change");
  assert.equal(chat.length, 1, "one message");
  assert.deepEqual(chatIds, [message.clientMessageId]);

  // Creating a room
  const headers = { cookie: sam.cookie, "x-duck-room": "1", "x-command-id": uuid() };
  const codes = [];
  for (let i = 0; i < 2; i++) codes.push(((await (await fetch(`${url}/api/rooms`, { method: "POST", headers })).json()) as { code: string }).code);
  assert.equal(codes[0], codes[1]);
});

test("a command id is not a way around the checks", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const command = { commandId: uuid() };
  assert.equal(errorCode(await ask(bow.socket, "music:next", command)), "FORBIDDEN");
  assert.equal(errorCode(await ask(bow.socket, "music:next", command)), "FORBIDDEN"); // a refused command is not remembered as done
  assert.equal(errorCode(await ask(sam.socket, "music:next", { commandId: "not-an-id" })), "INVALID_PAYLOAD");
});
