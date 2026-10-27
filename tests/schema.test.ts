// The socket contract itself: one list of events, strict payloads, standard errors and answers.
// These are the checks the event schema asks for. Feature behaviour is tested in the other files.
import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DEFAULT_EVENTS } from "../config/events";
import type { SeasonalEvent } from "../shared/events";
import {
  CLIENT_EVENTS,
  DJSchema,
  JoinSchema,
  MessageSchema,
  MoveSchema,
  MusicModeSchema,
  PositionSchema,
  ResyncSchema,
  RoomCreateSchema,
  SOCKET_ERROR_CODES,
  StationSchema,
  type MusicState,
  type RoomState,
} from "../shared/protocol";
import { PickupSchema, ReleaseSchema } from "../shared/interactions";
import { classifyVersion, newCommandId, newer } from "../shared/sync";
import { ask, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});
const start = async (...args: Parameters<typeof startServer>) => (server = await startServer(...args));
const loyKrathong: SeasonalEvent = {
  ...DEFAULT_EVENTS.find((event) => event.slug === "loy-krathong")!,
  startAt: new Date(Date.now() - 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 3_600_000).toISOString(),
};

// --- The schemas, without a server ---------------------------------------------------------

test("every payload schema refuses unknown fields, so a client cannot slip in a user id or a role", () => {
  const id = uuid();
  const valid: [string, { safeParse: (value: unknown) => { success: boolean } }, object][] = [
    ["room:create", RoomCreateSchema, { commandId: id, displayName: "Sam", duckColor: "yellow" }],
    ["room:join", JoinSchema, { roomCode: "ABCDEFGH", displayName: "Sam", duckColor: "yellow" }],
    ["room:resync", ResyncSchema, { roomCode: "ABCDEFGH", reason: "VERSION_GAP" }],
    ["duck:move", MoveSchema, { clientMoveId: id, destination: { x: 0.5, y: 0.5 } }],
    ["chat:message", MessageSchema, { clientMessageId: id, text: "hi" }],
    ["music:station", StationSchema, { commandId: id, stationId: "jazz" }],
    ["music:permission:setMode", MusicModeSchema, { commandId: id, mode: "EVERYONE" }],
    ["music:permission:addDJ", DJSchema, { commandId: id, targetUserId: id }],
    ["krathong:pickup", PickupSchema, { commandId: id, stallId: "krathong-stall-01", variant: "lotus-pink" }],
    ["krathong:release", ReleaseSchema, { commandId: id, zoneId: "river-release-01" }],
  ];
  for (const [event, schema, payload] of valid) {
    assert.ok(schema.safeParse(payload).success, `${event}: a valid payload`);
    for (const extra of [{ userId: id }, { role: "OWNER" }, { isOwner: true }, { isDJ: true }]) {
      assert.ok(!schema.safeParse({ ...payload, ...extra }).success, `${event}: ${JSON.stringify(extra)}`);
    }
  }
  // Fields only the server may decide.
  assert.ok(!RoomCreateSchema.safeParse({ commandId: id, displayName: "Sam", duckColor: "yellow", roomCode: "AAAAAAAA" }).success);
  assert.ok(!RoomCreateSchema.safeParse({ commandId: id, displayName: "Sam", duckColor: "yellow", ownerUserId: id }).success);
  assert.ok(!MoveSchema.safeParse({ clientMoveId: id, destination: { x: 0.5, y: 0.5 }, speed: 99 }).success);
  assert.ok(!ReleaseSchema.safeParse({ commandId: id, zoneId: "river-release-01", driftSpeed: 9 }).success);
});

test("positions must be finite numbers from 0 to 1", () => {
  for (const good of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.25, y: 0.75 }]) assert.ok(PositionSchema.safeParse(good).success);
  for (const bad of [{ x: -0.01, y: 0.5 }, { x: 0.5, y: 1.01 }, { x: Number.NaN, y: 0.5 }, { x: Number.POSITIVE_INFINITY, y: 0.5 }, { x: "0.5", y: 0.5 }, { x: 0.5 }, { x: 0.5, y: 0.5, z: 0 }]) {
    assert.ok(!PositionSchema.safeParse(bad).success, JSON.stringify(bad));
  }
});

test("commands that change shared things must carry a real id", () => {
  assert.ok(!StationSchema.safeParse({ stationId: "jazz" }).success);
  assert.ok(!StationSchema.safeParse({ stationId: "jazz", commandId: "1" }).success);
  assert.ok(!ReleaseSchema.safeParse({ zoneId: "river-release-01" }).success);
  assert.ok(!PickupSchema.safeParse({ stallId: "krathong-stall-01", variant: "lotus-pink" }).success);
  assert.match(newCommandId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(StationSchema.safeParse({ stationId: "jazz", commandId: newCommandId() }).success);
});

test("event names follow one style, and the browser and server share one definition", () => {
  for (const name of CLIENT_EVENTS) assert.match(name, /^[a-z]+(:[a-zA-Z]+)+$/, name);
  assert.equal(new Set(CLIENT_EVENTS).size, CLIENT_EVENTS.length);
  for (const code of SOCKET_ERROR_CODES) assert.match(code, /^[A-Z_]+$/);

  // No file outside shared/ declares the event maps again.
  const declares = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : declares(full);
      return /\.tsx?$/.test(entry.name) && /interface (ClientToServerEvents|ServerToClientEvents)/.test(readFileSync(full, "utf8")) ? [full] : [];
    });
  const root = path.join(import.meta.dirname, "..");
  assert.deepEqual(
    ["app", "components", "features", "lib", "server", "shared"].flatMap((dir) => declares(path.join(root, dir))).map((file) => path.relative(root, file)).sort(),
    ["shared/socket/client-events.ts", "shared/socket/server-events.ts"],
  );
});

test("client rules: the next version is applied, an old one ignored, a jump means resync; music keeps the newer state", () => {
  assert.deepEqual([classifyVersion(4, 5), classifyVersion(4, 4), classifyVersion(4, 3), classifyVersion(4, 7)], ["apply", "ignore", "ignore", "gap"]);
  const current = { version: 5, stationId: "jazz" };
  assert.equal(newer(current, { version: 4, stationId: "rain" }), current, "a stale music state is ignored");
  assert.equal(newer(current, { version: 6, stationId: "rain" }).stationId, "rain");
});

// --- Against a running server --------------------------------------------------------------

test("bad payloads are answered with INVALID_PAYLOAD and change nothing", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const move = (payload: object) => ask(sam.socket, "duck:move", { clientMoveId: uuid(), ...payload });

  assert.equal(errorCode(await move({ destination: { x: 2, y: 0.5 } })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await move({ destination: { x: 0.5, y: -1 } })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await move({ destination: { x: 0.5, y: 0.5 }, userId: bow.userId })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await move({ x: 0.5, y: 0.5 })), "INVALID_PAYLOAD"); // the old shape
  assert.equal(errorCode(await ask(sam.socket, "chat:message", { text: "x".repeat(301) })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(sam.socket, "chat:message", { text: "hi", userId: bow.userId })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(sam.socket, "chat:message", { text: "hi", displayName: "Bow" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(sam.socket, "sticker:send", { stickerId: "no-such-sticker" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(sam.socket, "music:station", { stationId: "no-such-station" })), "INVALID_STATE");
  assert.equal(errorCode(await ask(sam.socket, "music:play", { commandId: "not-a-uuid" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(sam.socket, "music:permission:addDJ", { targetUserId: bow.userId, role: "OWNER" })), "INVALID_PAYLOAD");

  const state = await once<RoomState>(sam.socket, "room:snapshot", () => ask(sam.socket, "room:resync", { roomCode: sam.code, reason: "MANUAL" }));
  assert.equal(state.version, bow.state.version, "nothing above changed the room");
});

test("a member who is not a DJ cannot control music; roles in the payload count for nothing", async () => {
  const { duck } = await start();
  const owner = await duck();
  const bow = await duck(owner.code, "Bow");
  for (const event of ["music:play", "music:pause", "music:next"]) assert.equal(errorCode(await ask(bow.socket, event)), "FORBIDDEN", event);
  assert.equal(errorCode(await ask(bow.socket, "music:station", { stationId: "jazz" })), "FORBIDDEN");
  assert.equal(errorCode(await ask(bow.socket, "music:play", { commandId: uuid(), isDJ: true })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(bow.socket, "music:permission:setMode", { mode: "EVERYONE" })), "FORBIDDEN");
  assert.equal(errorCode(await ask(bow.socket, "music:permission:addDJ", { targetUserId: bow.userId })), "FORBIDDEN");
});

test("krathong errors: event off, too far, nothing to release", async () => {
  const off = await start();
  const sam = await off.duck();
  assert.equal(errorCode(await ask(sam.socket, "krathong:pickup", { stallId: "krathong-stall-01", variant: "lotus-pink" })), "EVENT_INACTIVE");
  assert.equal(errorCode(await ask(sam.socket, "krathong:release", { zoneId: "river-release-01" })), "EVENT_INACTIVE");
  await off.stop();

  const on = await start({}, {}, { events: [loyKrathong] });
  const bow = await on.duck();
  await ask(bow.socket, "duck:move", { destination: { x: 0.05, y: 0.45 } });
  assert.equal(errorCode(await ask(bow.socket, "krathong:pickup", { stallId: "krathong-stall-01", variant: "lotus-pink" })), "TOO_FAR");
  await ask(bow.socket, "duck:move", { destination: { x: 0.5, y: 0.85 } });
  assert.equal(errorCode(await ask(bow.socket, "krathong:release", { zoneId: "river-release-01" })), "INVALID_STATE");
});

test("a repeated release creates one krathong and gets the first answer again", async () => {
  const { duck } = await start({}, {}, { events: [loyKrathong] });
  const sam = await duck();
  let spawned = 0;
  sam.socket.on("krathong:spawned", () => spawned++);
  await ask(sam.socket, "duck:move", { destination: { x: 0.45, y: 0.05 } });
  const pickup = { commandId: uuid(), stallId: "krathong-stall-01", variant: "lotus-pink" };
  assert.deepEqual(await ask(sam.socket, "krathong:pickup", pickup), { ok: true, commandId: pickup.commandId });
  assert.deepEqual(await ask(sam.socket, "krathong:pickup", pickup), { ok: true, commandId: pickup.commandId }, "not 'already carrying'");
  await ask(sam.socket, "duck:move", { destination: { x: 0.5, y: 0.85 } });

  const release = { commandId: uuid(), zoneId: "river-release-01" };
  const first = await ask(sam.socket, "krathong:release", release);
  const again = await ask(sam.socket, "krathong:release", release);
  await wait(60);
  assert.equal(spawned, 1);
  assert.ok(first.ok && first.commandId === release.commandId && first.data?.krathongId && first.data.interactionId);
  assert.deepEqual(again, first);
});

test("room:create makes the room for the session's user and is safe to repeat", async () => {
  const { visitor, connect } = await start();
  const who = await visitor();
  const socket = await connect(who.cookie);
  const create = { commandId: uuid(), displayName: "Sam", duckColor: "yellow" };
  for (const extra of [{ roomId: "x" }, { roomCode: "AAAAAAAA" }, { ownerUserId: uuid() }, { isOwner: true }]) {
    assert.equal(errorCode(await ask(socket, "room:create", { ...create, ...extra })), "INVALID_PAYLOAD", JSON.stringify(extra));
  }
  const made = await ask(socket, "room:create", create);
  assert.ok(made.ok && made.data);
  assert.match(made.data.roomCode, /^[A-Z2-9]{8}$/);
  assert.deepEqual(await ask(socket, "room:create", create), made, "the same id never opens a second room");

  const snapshot = once<RoomState>(socket, "room:snapshot");
  assert.equal(errorCode(await ask(socket, "room:join", { roomCode: made.data.roomCode, displayName: "Sam", duckColor: "yellow" })), "OK");
  const state = await snapshot;
  assert.deepEqual([state.roomId, state.ownerUserId], [made.data.roomId, who.userId]);
  assert.equal(errorCode(await ask(socket, "room:join", { roomCode: made.data.roomCode, displayName: "Sam", duckColor: "yellow" })), "CONFLICT");
});

test("room:create is limited", async () => {
  const { visitor, connect } = await start({}, { createRoom: { limit: 2, windowMs: 60_000 } });
  const socket = await connect((await visitor()).cookie);
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await ask(socket, "room:create", { displayName: "Sam", duckColor: "yellow" }));
  assert.deepEqual(results.map(errorCode), ["OK", "OK", "RATE_LIMITED"]);
  const refused = results[2];
  assert.ok(!refused.ok && refused.error.retryAfterMs! > 0 && refused.error.retryAfterMs! <= 60_000, "it says how long to wait");
});

test("after a reconnect, room:resume gives the duck back with a fresh snapshot", async () => {
  const { duck, connect } = await start({ presenceGraceMs: 60_000 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await ask(bow.socket, "duck:move", { destination: { x: 0.25, y: 0.75 } });
  let chat = 0;
  sam.socket.on("chat:message", () => chat++);
  bow.socket.disconnect();
  await wait(40);

  const again = await connect(bow.cookie);
  const snapshot = once<RoomState>(again, "room:snapshot");
  const history = once<{ messages: unknown[] }>(again, "chat:history");
  assert.equal(errorCode(await ask(again, "room:resume", { roomCode: sam.code, lastKnownVersions: { room: 1, music: 1 } })), "OK");
  const state = await snapshot;
  const me = state.users.find((user) => user.id === bow.userId)!;
  assert.deepEqual([me.displayName, me.connected, me.x, me.y], ["Bow", true, 0.25, 0.75]);
  assert.ok((await history).messages.length > 0);
  await wait(40);
  assert.equal(chat, 0, "no 'left' and no 'joined' message");

  // Resume is only for someone the room still holds, and takes no profile and no identity.
  const stranger = await connect((await server!.visitor()).cookie);
  assert.equal(errorCode(await ask(stranger, "room:resume", { roomCode: sam.code })), "NOT_IN_ROOM");
  assert.equal(errorCode(await ask(stranger, "room:resume", { roomCode: "ZZZZZZZZ" })), "ROOM_NOT_FOUND");
  assert.equal(errorCode(await ask(stranger, "room:resume", { roomCode: sam.code, userId: bow.userId })), "INVALID_PAYLOAD");
});

test("a resync must name the room you are in, and a reason", async () => {
  const { duck } = await start();
  const sam = await duck();
  const other = await duck();
  assert.equal(errorCode(await ask(sam.socket, "room:resync", { roomCode: other.code, reason: "MANUAL" })), "NOT_IN_ROOM");
  assert.equal(errorCode(await ask(sam.socket, "room:resync", { roomCode: sam.code, reason: "BECAUSE" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(sam.socket, "room:resync")), "INVALID_PAYLOAD");
});

test("each part of the room counts its own changes, and a snapshot carries them all", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const seen: Record<string, number>[] = [];
  bow.socket.onAny((_event, payload) => typeof payload?.roomVersion === "number" && seen.push(payload));

  await ask(sam.socket, "duck:move", { destination: { x: 0.3, y: 0.3 } });
  await ask(sam.socket, "chat:message", { text: "hi" });
  await ask(sam.socket, "music:play");
  await ask(sam.socket, "duck:move", { destination: { x: 0.4, y: 0.4 } });
  await wait(50);

  const users = seen.filter((update) => "usersVersion" in update).map((update) => update.usersVersion);
  assert.deepEqual(users, [bow.state.versions.users + 1, bow.state.versions.users + 2], "two moves, two user versions; chat and music did not touch it");
  const music = seen.find((update) => "state" in update) as unknown as { state: MusicState };
  assert.equal(music.state.version, bow.state.versions.music + 1);

  const state = await once<RoomState>(bow.socket, "room:snapshot", () => ask(bow.socket, "room:resync", { roomCode: bow.code, reason: "MANUAL" }));
  assert.deepEqual(
    [state.versions.room, state.versions.users, state.versions.music],
    [bow.state.version + 4, bow.state.versions.users + 2, bow.state.versions.music + 1],
  );
});

test("errors without an acknowledgement arrive as socket:error, with the event's name", async () => {
  const { duck } = await start();
  const sam = await duck();
  const sent = once<{ error: { code: string; message: string }; event?: string; serverTime: number }>(sam.socket, "socket:error");
  sam.socket.emit("music:station", { commandId: uuid(), stationId: "no-such-station" });
  const { error, event, serverTime } = await sent;
  assert.deepEqual([error.code, event], ["INVALID_STATE", "music:station"]);
  assert.ok(Math.abs(serverTime - Date.now()) < 5000);
  // The message is for a person: no stack, no path, no internals.
  assert.doesNotMatch(error.message, /\bat \w|\/|Error|undefined/);
});

test("who left, and why", async () => {
  const { duck } = await start({ presenceGraceMs: 80 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const alex = await duck(sam.code, "Alex");

  let left = once<{ userId: string; reason: string }>(sam.socket, "room:userLeft");
  await ask(bow.socket, "room:leave");
  assert.deepEqual([(await left).userId, (await left).reason], [bow.userId, "LEFT"]);

  left = once<{ userId: string; reason: string }>(sam.socket, "room:userLeft");
  alex.socket.disconnect();
  assert.deepEqual([(await left).userId, (await left).reason], [alex.userId, "TIMEOUT"]);
});

test("refused commands are logged with the event, the user and the code, and nothing private", async () => {
  const { duck, entries } = await start();
  const sam = await duck();
  await ask(sam.socket, "music:station", { stationId: "no-such-station" });
  const entry = entries.find((log) => log.event === "COMMAND_REJECTED");
  assert.deepEqual([entry?.userId, entry?.roomId, entry?.result, entry?.detail], [sam.userId, sam.state.roomId, "INVALID_STATE", "music:station"]);
  assert.doesNotMatch(JSON.stringify(entries), new RegExp(`${sam.code}|${sam.cookie.slice(-20)}`), "no room code and no cookie in the log");
});
