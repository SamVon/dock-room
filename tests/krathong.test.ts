// Loy Krathong: pick up a krathong, carry it, and float it. The server decides every step.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Socket } from "socket.io-client";
import { DEFAULT_EVENTS } from "../config/events";
import type { SeasonalEvent } from "../shared/events";
import type { CarriedItem, FloatingKrathong } from "../shared/interactions";
import { INTERACTION_ZONES, inZone, krathongPosition } from "../shared/interactions";
import type { RoomState } from "../shared/protocol";
import { ask, bare, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const builtIn = DEFAULT_EVENTS.find((event) => event.slug === "loy-krathong")!;
/** The Loy Krathong event, running now, optionally with different krathong limits. */
const festival = (krathong: Partial<NonNullable<NonNullable<SeasonalEvent["interactions"]>["krathong"]>> = {}): SeasonalEvent => ({
  ...builtIn,
  startAt: new Date(Date.now() - 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 3_600_000).toISOString(),
  interactions: { krathong: { ...builtIn.interactions!.krathong!, userCooldownMs: 0, ...krathong } },
});
const start = async (krathong?: Parameters<typeof festival>[0], overrides: Parameters<typeof startServer>[0] = {}) =>
  (server = await startServer(overrides, { krathongPickup: { limit: 1000, windowMs: 1000 }, krathongRelease: { limit: 1000, windowMs: 1000 } }, { events: [festival(krathong)] }));

const STALL = { x: 0.45, y: 0.05 }; // in front of the krathong stall
const RIVER = { x: 0.5, y: 0.85 }; // on the near bank, at the water's edge
const FIELD = { x: 0.05, y: 0.45 }; // far from both
const walk = (socket: Socket, to: { x: number; y: number }) => ask(socket, "duck:move", { destination: to });
const pickup = (socket: Socket, extra: object = {}) => ask(socket, "krathong:pickup", { stallId: "krathong-stall-01", variant: "lotus-pink", ...extra });
const release = (socket: Socket, extra: object = {}) => ask(socket, "krathong:release", { zoneId: "river-release-01", ...extra });
/** Take a krathong at the stall and carry it to the river. */
const carryToRiver = async (socket: Socket) => {
  await walk(socket, STALL);
  assert.equal(errorCode(await pickup(socket)), "OK");
  await walk(socket, RIVER);
};

test("the zones are where the scene puts the stall and the river", () => {
  assert.ok(inZone(INTERACTION_ZONES["krathong-stall-01"], STALL.x, STALL.y));
  assert.ok(inZone(INTERACTION_ZONES["river-release-01"], RIVER.x, RIVER.y));
  assert.ok(!inZone(INTERACTION_ZONES["krathong-stall-01"], FIELD.x, FIELD.y));
  assert.ok(!inZone(INTERACTION_ZONES["river-release-01"], FIELD.x, FIELD.y));
});

test("a duck near the stall picks up a krathong, others see it, and it can still walk", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await walk(sam.socket, STALL);

  const seen = once<{ userId: string; activity: string; carriedItem: CarriedItem; usersVersion: number }>(bow.socket, "duck:stateChanged");
  assert.equal(errorCode(await pickup(sam.socket)), "OK");
  // The duck's own state carries the result of a pickup. There is no separate "picked up" event.
  const { usersVersion, ...carrying } = bare(await seen);
  assert.deepEqual(carrying, { userId: sam.userId, activity: "idle", carriedItem: { type: "krathong", variant: "lotus-pink" } });
  assert.ok(usersVersion > 0);
  assert.equal(errorCode(await pickup(sam.socket)), "INVALID_STATE"); // already carrying one

  const moved = once<{ userId: string; destination: { x: number } }>(bow.socket, "duck:moved");
  await walk(sam.socket, RIVER);
  assert.equal((await moved).destination.x, RIVER.x);

  const late = await duck(sam.code, "Mia");
  assert.deepEqual(late.state.users.find((user) => user.id === sam.userId)?.carriedItem, { type: "krathong", variant: "lotus-pink" });
});

test("a duck far from the stall cannot pick one up", async () => {
  const { duck } = await start();
  const sam = await duck();
  await walk(sam.socket, FIELD);
  assert.equal(errorCode(await pickup(sam.socket)), "TOO_FAR");
  assert.equal(errorCode(await pickup(sam.socket, { stallId: "river-release-01" })), "OBJECT_NOT_FOUND"); // not a stall
  assert.equal(errorCode(await pickup(sam.socket, { stallId: "secret-stall" })), "OBJECT_NOT_FOUND");
  await walk(sam.socket, STALL);
  assert.equal(errorCode(await pickup(sam.socket, { variant: "diamond" })), "OBJECT_NOT_FOUND");
});

test("releasing needs a krathong and the river's edge", async () => {
  const { duck } = await start();
  const sam = await duck();
  await walk(sam.socket, RIVER);
  assert.equal(errorCode(await release(sam.socket)), "INVALID_STATE"); // nothing to release

  await walk(sam.socket, STALL);
  await pickup(sam.socket);
  await walk(sam.socket, FIELD);
  assert.equal(errorCode(await release(sam.socket)), "TOO_FAR"); // carrying, but not at the water
  assert.equal(errorCode(await release(sam.socket, { zoneId: "krathong-stall-01" })), "OBJECT_NOT_FOUND"); // not a release zone
});

test("a carried krathong is set afloat: the server decides where, which way and for how long", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await carryToRiver(sam.socket);

  const released = once<{ userId: string; activity: string; carriedItem: null; interactionId: string; startedAt: number; endsAt: number }>(bow.socket, "duck:stateChanged");
  const spawnedUpdate = once<{ krathong: FloatingKrathong; interactionId: string; krathongVersion: number }>(bow.socket, "krathong:spawned");
  const spawned = spawnedUpdate.then((update) => update.krathong);
  const before = Date.now();
  const answer = await release(sam.socket);
  assert.equal(errorCode(answer), "OK");

  const busy = await released;
  assert.deepEqual([busy.userId, busy.activity, busy.carriedItem], [sam.userId, "releasing-krathong", null]);
  const releaseMs = busy.endsAt - busy.startedAt;
  assert.ok(releaseMs >= 1500 && releaseMs <= 2200);

  const krathong = await spawned;
  // The duck's state change, the new krathong and the acknowledgement all name the same interaction.
  assert.equal((await spawnedUpdate).interactionId, busy.interactionId);
  assert.deepEqual(answer.ok && answer.data, { krathongId: krathong.id, interactionId: busy.interactionId });
  assert.equal((await spawnedUpdate).krathongVersion, 1);
  assert.equal(krathong.ownerUserId, sam.userId);
  assert.equal(krathong.variant, "lotus-pink");
  assert.equal(krathong.startX, RIVER.x); // where the duck stood, by the server's record
  assert.equal(krathong.startY, INTERACTION_ZONES["river-release-01"].waterY); // on the water, not on the bank
  assert.ok(krathong.driftX > 0, "it drifts downstream");
  assert.ok(krathong.createdAt > before, "it touches the water a moment after the release starts");
  assert.equal(krathong.expiresAt - krathong.createdAt, 40_000);

  // Position is worked out from this one message: later is further downstream.
  const early = krathongPosition(krathong, krathong.createdAt + 1000);
  const later = krathongPosition(krathong, krathong.createdAt + 20_000);
  assert.ok(later.x > early.x && early.x > krathong.startX);

  // The duck is no longer carrying it, and cannot release it twice.
  assert.equal(errorCode(await release(sam.socket)), "INVALID_STATE");
});

test("nothing is sent while a krathong drifts", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await carryToRiver(sam.socket);
  await release(sam.socket);
  await wait(50);

  let events = 0;
  bow.socket.onAny(() => events++);
  await wait(400);
  assert.equal(events, 0);
});

test("fake user ids, positions and drift values are rejected", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await walk(sam.socket, STALL);
  for (const extra of [{ userId: bow.userId }, { isOwner: true }, { x: 0.45, y: 0.05 }]) {
    assert.equal(errorCode(await pickup(sam.socket, extra)), "INVALID_PAYLOAD", JSON.stringify(extra));
  }
  // Claiming a position does not move the duck: from the field, a "pickup at the stall" still fails.
  await walk(sam.socket, FIELD);
  assert.equal(errorCode(await pickup(sam.socket)), "TOO_FAR");

  await carryToRiver(sam.socket);
  for (const extra of [{ userId: bow.userId }, { ownerUserId: bow.userId }, { x: 0.9, y: 0.5 }, { driftSpeed: 99 }, { eventId: "evt-loy-krathong" }]) {
    assert.equal(errorCode(await release(sam.socket, extra)), "INVALID_PAYLOAD", JSON.stringify(extra));
  }
  // A client cannot announce a krathong of its own, or say it is carrying one.
  for (const [name, payload] of [
    ["krathong:spawned", { krathong: { id: "x", ownerUserId: bow.userId, startX: 0.5, startY: 0.5 } }],
    ["duck:stateChanged", { userId: sam.userId, activity: "idle", carriedItem: { type: "krathong", variant: "gold-flower" } }],
  ] as const) {
    const error = once<{ error: { code: string } }>(sam.socket, "socket:error").then((sent) => sent.error);
    sam.socket.emit(name, payload);
    assert.equal((await error).code, "INVALID_PAYLOAD", name);
  }
  assert.equal(errorCode(await ask(sam.socket, "room:join", { roomCode: sam.code, displayName: "Sam", duckColor: "yellow", carriedItem: { type: "krathong", variant: "gold-flower" } })), "INVALID_PAYLOAD");
});

test("floating krathongs has a cooldown per duck", async () => {
  const { duck } = await start({ userCooldownMs: 15_000 });
  const sam = await duck();
  await carryToRiver(sam.socket);
  assert.equal(errorCode(await release(sam.socket)), "OK");

  await wait(1900); // the release itself has finished
  await carryToRiver(sam.socket);
  assert.equal(errorCode(await release(sam.socket)), "RATE_LIMITED");
});

test("while setting a krathong down, the duck cannot walk or start anything else", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await carryToRiver(sam.socket);
  await release(sam.socket);

  let moved = 0;
  bow.socket.on("duck:moved", () => moved++);
  await walk(sam.socket, STALL);
  await wait(60);
  assert.equal(moved, 0);
  assert.equal(errorCode(await pickup(sam.socket)), "TOO_FAR"); // still at the river

  await wait(1900);
  await walk(sam.socket, STALL);
  await wait(40); // let the broadcast reach Bow
  assert.equal(moved, 1);
  assert.equal(errorCode(await pickup(sam.socket)), "OK");
});

test("when the festival is not on, there is no pickup and no release", async () => {
  server = await startServer({}, {}, { events: [] });
  const sam = await server.duck();
  await walk(sam.socket, STALL);
  assert.equal(errorCode(await pickup(sam.socket)), "EVENT_INACTIVE");
  await walk(sam.socket, RIVER);
  assert.equal(errorCode(await release(sam.socket)), "EVENT_INACTIVE");
});

test("when the festival ends, carried krathongs are put down and the river is cleared", async () => {
  const s = await start();
  const sam = await s.duck();
  const bow = await s.duck(sam.code, "Bow");
  await carryToRiver(sam.socket);
  await release(sam.socket);
  await walk(bow.socket, STALL);
  await pickup(bow.socket);

  const dropped = once<{ userId: string; carriedItem: null }>(sam.socket, "duck:stateChanged");
  const cleared = once<{ krathongId: string; reason: string }>(sam.socket, "krathong:removed");
  s.clock.now = Date.now() + 2 * 3_600_000;
  s.events.tick();
  assert.deepEqual([(await dropped).userId, (await dropped).carriedItem], [bow.userId, null]);
  assert.equal((await cleared).reason, "EVENT_ENDED");
});

test("the river has a limit: the oldest krathong makes room for a new one", async () => {
  const { duck } = await start({ maxFloatingPerRoom: 2 });
  const sam = await duck();
  const ducks = [sam, await duck(sam.code, "Bow"), await duck(sam.code, "Alex")];
  const spawned: string[] = [];
  const removed: string[] = [];
  sam.socket.on("krathong:spawned", ({ krathong }: { krathong: FloatingKrathong }) => spawned.push(krathong.id));
  sam.socket.on("krathong:removed", ({ krathongId }: { krathongId: string }) => removed.push(krathongId));

  for (const one of ducks) {
    await carryToRiver(one.socket);
    assert.equal(errorCode(await release(one.socket)), "OK"); // nobody is refused
  }
  await wait(60);
  assert.equal(spawned.length, 3);
  assert.deepEqual(removed, [spawned[0]]);

  const late = await duck(sam.code, "Mia");
  assert.deepEqual(late.state.krathongs.map((krathong) => krathong.id), spawned.slice(1));
});

test("krathongs expire by themselves", async () => {
  const { duck } = await start({ floatDurationMs: 5000 });
  const sam = await duck();
  await carryToRiver(sam.socket);
  await release(sam.socket);
  assert.equal((await duck(sam.code, "Bow")).state.krathongs.length, 1);

  // Nothing has to be sent for this: once its time is up, it is simply no longer in the room.
  await wait(5000 + 900);
  assert.equal((await duck(sam.code, "Alex")).state.krathongs.length, 0);
});

test("a krathong keeps floating after its owner disconnects", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await carryToRiver(sam.socket);
  await release(sam.socket);

  let removed = 0;
  bow.socket.on("krathong:removed", () => removed++);
  sam.socket.disconnect();
  await wait(80);
  assert.equal(removed, 0);
  const late = await duck(bow.code, "Mia");
  assert.equal(late.state.krathongs.length, 1);
  assert.equal(late.state.krathongs[0].ownerUserId, sam.userId);
});

test("a duck that reconnects soon is still carrying its krathong; a claim from the client changes nothing", async () => {
  const { duck, connect, visitor } = await start({}, { presenceGraceMs: 5000 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await walk(sam.socket, STALL);
  await pickup(sam.socket);
  sam.socket.disconnect();
  await wait(40);

  const again = await connect(sam.cookie);
  const state = once<RoomState>(again, "room:snapshot");
  await ask(again, "room:join", { roomCode: sam.code, displayName: "Sam", duckColor: "yellow" });
  assert.deepEqual((await state).users.find((user) => user.id === sam.userId)?.carriedItem, { type: "krathong", variant: "lotus-pink" });

  // A different session joining the room has nothing, whatever it sends.
  const other = await connect((await visitor()).cookie);
  const otherState = once<RoomState>(other, "room:snapshot");
  await ask(other, "room:join", { roomCode: bow.code, displayName: "Eve", duckColor: "black" });
  assert.ok((await otherState).users.every((user) => user.displayName !== "Eve" || !user.carriedItem));
});

test("after the grace period, a returning duck no longer carries anything", async () => {
  const { duck, connect } = await start({}, { presenceGraceMs: 30 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await walk(sam.socket, STALL);
  await pickup(sam.socket);
  sam.socket.disconnect();
  await wait(120);

  const again = await connect(sam.cookie);
  const state = once<RoomState>(again, "room:snapshot");
  await ask(again, "room:join", { roomCode: bow.code, displayName: "Sam", duckColor: "yellow" });
  assert.equal((await state).users.find((user) => user.id === sam.userId)?.carriedItem, undefined);
});
