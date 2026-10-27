// Loy Krathong with many rooms and many ducks at once. Each room must keep its own krathongs,
// versions and events, and nothing may leak from one room, or one moment, into another.
import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { afterEach, test } from "node:test";
import type { Socket } from "socket.io-client";
import { DEFAULT_EVENTS } from "../config/events";
import { createKrathongTimeline } from "../lib/krathongTimeline";
import type { SeasonalEvent } from "../shared/events";
import { krathongPosition, type FloatingKrathong } from "../shared/interactions";
import type { RoomState } from "../shared/protocol";
import { ask, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const builtIn = DEFAULT_EVENTS.find((event) => event.slug === "loy-krathong")!;
const festival = (krathong: Partial<NonNullable<NonNullable<SeasonalEvent["interactions"]>["krathong"]>> = {}): SeasonalEvent => ({
  ...builtIn,
  startAt: new Date(Date.now() - 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 3_600_000).toISOString(),
  interactions: { krathong: { ...builtIn.interactions!.krathong!, userCooldownMs: 0, ...krathong } },
});
const open = { limit: 10_000, windowMs: 1000 };
const start = async (krathong?: Parameters<typeof festival>[0], overrides: Parameters<typeof startServer>[0] = {}) =>
  (server = await startServer(overrides, { krathongPickup: open, krathongRelease: open }, { events: [festival(krathong)] }));

type Duck = Awaited<ReturnType<Awaited<ReturnType<typeof start>>["duck"]>>;
const STALL = { x: 0.45, y: 0.05 };
const walk = (socket: Socket, to: { x: number; y: number }) => ask(socket, "duck:move", { destination: to });
const pickup = (socket: Socket) => ask(socket, "krathong:pickup", { stallId: "krathong-stall-01", variant: "lotus-pink" });
const release = (socket: Socket, commandId = uuid()) => ask(socket, "krathong:release", { zoneId: "river-release-01", commandId });
/** Take a krathong and stand at the river, each duck at its own spot along the bank. */
const carryToRiver = async (duck: Duck, x = 0.5) => {
  await walk(duck.socket, STALL);
  assert.equal(errorCode(await pickup(duck.socket)), "OK");
  await walk(duck.socket, { x, y: 0.85 });
};
const spread = (index: number, count: number) => 0.15 + (0.7 * index) / Math.max(1, count - 1);

type Update = { event: string; roomVersion: number; krathongVersion?: number; usersVersion?: number; userId?: string; krathong?: FloatingKrathong; krathongId?: string };
/** Everything about shared state that reaches this socket from now on. */
const record = (socket: Socket) => {
  const seen: Update[] = [];
  socket.onAny((event: string, payload?: Omit<Update, "event">) => typeof payload?.roomVersion === "number" && seen.push({ ...payload, event }));
  return seen;
};
const snapshotOf = (duck: Duck) => once<RoomState>(duck.socket, "room:snapshot", () => ask(duck.socket, "room:resync", { roomCode: duck.code, reason: "MANUAL" }));
const ids = (list: readonly FloatingKrathong[]) => list.map((item) => item.id).sort();

// --- One room, many ducks ------------------------------------------------------------------

test("many ducks float a krathong at the same moment in one room: one each, in one agreed order", async () => {
  const { duck } = await start();
  const host = await duck();
  const ducks = [host];
  for (let i = 1; i < 8; i++) ducks.push(await duck(host.code, `Duck${i}`));
  for (const [i, one] of ducks.entries()) await carryToRiver(one, spread(i, ducks.length));

  const watcher = await duck(host.code, "Watcher");
  const seen = record(watcher.socket);
  const answers = await Promise.all(ducks.map((one) => release(one.socket))); // all at once
  await wait(80);

  assert.deepEqual(answers.map(errorCode), ducks.map(() => "OK"), "nobody is refused");
  const spawned = seen.filter((update) => update.event === "krathong:spawned");
  assert.equal(spawned.length, ducks.length);
  assert.equal(new Set(spawned.map((update) => update.krathong!.id)).size, ducks.length, "every krathong has its own id");
  assert.deepEqual(spawned.map((update) => update.krathong!.ownerUserId).sort(), ducks.map((one) => one.userId).sort(), "one per duck");
  // Each krathong starts where its own duck stood, not where another one did.
  for (const [i, one] of ducks.entries()) {
    assert.equal(spawned.find((update) => update.krathong!.ownerUserId === one.userId)!.krathong!.startX, spread(i, ducks.length));
  }
  // One order for the whole room: room versions and krathong versions both count up without a hole.
  assert.deepEqual(seen.map((update) => update.roomVersion), seen.map((_, i) => watcher.state.version + 1 + i));
  assert.deepEqual(spawned.map((update) => update.krathongVersion), ducks.map((_, i) => i + 1));
  // Each answer names the krathong that this duck, and no other, set afloat.
  for (const [i, answer] of answers.entries()) {
    const mine = spawned.find((update) => update.krathong!.ownerUserId === ducks[i].userId)!;
    assert.equal(answer.ok && answer.data?.krathongId, mine.krathong!.id);
  }

  const state = await snapshotOf(watcher);
  assert.deepEqual(ids(state.krathongs), ids(spawned.map((update) => update.krathong!)));
  assert.ok(state.users.every((user) => !user.carriedItem), "nobody is still carrying one");
  assert.equal(state.versions.krathongs, ducks.length);
});

test("when the river is full and many release together, the limit holds and every browser ends with the same river", async () => {
  const { duck } = await start({ maxFloatingPerRoom: 3 });
  const host = await duck();
  const ducks = [host];
  for (let i = 1; i < 6; i++) ducks.push(await duck(host.code, `Duck${i}`));
  for (const [i, one] of ducks.entries()) await carryToRiver(one, spread(i, ducks.length));

  // Two browsers follow the updates and build their own list, the way the page does.
  const rivers = [ducks[0], ducks[5]].map((one) => {
    const afloat = new Set<string>();
    one.socket.on("krathong:spawned", ({ krathong }: { krathong: FloatingKrathong }) => afloat.add(krathong.id));
    one.socket.on("krathong:removed", ({ krathongId }: { krathongId: string }) => afloat.delete(krathongId));
    return afloat;
  });
  assert.deepEqual((await Promise.all(ducks.map((one) => release(one.socket)))).map(errorCode), ducks.map(() => "OK"));
  await wait(80);

  const state = await snapshotOf(host);
  assert.equal(state.krathongs.length, 3);
  for (const afloat of rivers) assert.deepEqual([...afloat].sort(), ids(state.krathongs));
});

// --- Many rooms ----------------------------------------------------------------------------

test("many rooms float krathongs at the same moment: each room gets its own, and only its own", async () => {
  const { duck } = await start();
  const rooms: Duck[][] = [];
  for (let r = 0; r < 4; r++) {
    const host = await duck(undefined, `R${r}-0`);
    rooms.push([host, await duck(host.code, `R${r}-1`), await duck(host.code, `R${r}-2`)]);
  }
  assert.equal(new Set(rooms.map((room) => room[0].code)).size, 4);
  assert.equal(new Set(rooms.map((room) => room[0].state.roomId)).size, 4);
  for (const room of rooms) for (const [i, one] of room.entries()) await carryToRiver(one, spread(i, 3));

  const seen = rooms.map((room) => room.map((one) => record(one.socket)));
  const everyone = rooms.flat();
  assert.deepEqual((await Promise.all(everyone.map((one) => release(one.socket)))).map(errorCode), everyone.map(() => "OK"));
  await wait(100);

  for (const [r, room] of rooms.entries()) {
    const members = new Set(room.map((one) => one.userId));
    for (const [d, updates] of seen[r].entries()) {
      const spawned = updates.filter((update) => update.event === "krathong:spawned");
      assert.equal(spawned.length, 3, `room ${r}, duck ${d}`);
      // Nothing about another room's ducks or krathongs reaches this socket.
      assert.ok(spawned.every((update) => members.has(update.krathong!.ownerUserId)));
      assert.ok(updates.every((update) => !update.userId || members.has(update.userId)), "no update about a duck from another room");
      // The room counts its own krathongs from 1, whatever the other rooms are doing.
      assert.deepEqual(spawned.map((update) => update.krathongVersion), [1, 2, 3]);
      assert.deepEqual(updates.map((update) => update.roomVersion), updates.map((_, i) => updates[0].roomVersion + i), "no hole in this room's versions");
    }
    // Every duck in the room saw the same updates in the same order.
    assert.deepEqual(seen[r][1], seen[r][0]);
    assert.deepEqual(seen[r][2], seen[r][0]);

    const state = await snapshotOf(room[0]);
    assert.equal(state.krathongs.length, 3);
    assert.ok(state.krathongs.every((item) => members.has(item.ownerUserId)));
    assert.equal(state.versions.krathongs, 3);
  }
  // No krathong id appears in two rooms.
  const all = (await Promise.all(rooms.map((room) => snapshotOf(room[1])))).flatMap((state) => ids(state.krathongs));
  assert.equal(new Set(all).size, 12);
});

test("limits are per room: a full river in one room removes nothing in another", async () => {
  const { duck } = await start({ maxFloatingPerRoom: 2 });
  const a = await duck();
  const a2 = await duck(a.code, "A2");
  const a3 = await duck(a.code, "A3");
  const b = await duck();
  let removedInB = 0;
  b.socket.on("krathong:removed", () => removedInB++);

  await carryToRiver(b);
  await release(b.socket);
  for (const one of [a, a2, a3]) {
    await carryToRiver(one);
    await release(one.socket);
  }
  await wait(60);
  assert.equal((await snapshotOf(a)).krathongs.length, 2);
  assert.equal((await snapshotOf(b)).krathongs.length, 1);
  assert.equal(removedInB, 0);
});

// --- Repeats -------------------------------------------------------------------------------

test("pressing twice, or sending the same request many times, floats one krathong", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  let spawned = 0;
  bow.socket.on("krathong:spawned", () => spawned++);

  // The same request five times at once, as a retry after a bad connection would send it.
  await carryToRiver(sam);
  const commandId = uuid();
  const same = await Promise.all(Array.from({ length: 5 }, () => release(sam.socket, commandId)));
  assert.ok(same.every((answer) => answer.ok));
  assert.equal(new Set(same.map((answer) => answer.ok && answer.data?.krathongId)).size, 1, "every answer names the same krathong");

  // Two presses, so two different ids: the second finds nothing left to release.
  await wait(1900); // the duck is busy setting the first one down
  await carryToRiver(sam);
  const [first, second] = await Promise.all([release(sam.socket), release(sam.socket)]);
  assert.deepEqual([errorCode(first), errorCode(second)], ["OK", "INVALID_STATE"]);

  // The same for taking one: two presses give one krathong to carry, not an error and not two.
  await wait(1900);
  await walk(sam.socket, STALL);
  const pickId = uuid();
  const picks = await Promise.all([1, 2, 3].map(() => ask(sam.socket, "krathong:pickup", { commandId: pickId, stallId: "krathong-stall-01", variant: "lotus-pink" })));
  assert.deepEqual(picks.map(errorCode), ["OK", "OK", "OK"]);

  await wait(60);
  assert.equal(spawned, 2);
  assert.equal((await snapshotOf(bow)).krathongs.length, 2);
});

test("a command id used in one room is not 'already done' in another room", async () => {
  const { duck } = await start();
  const a = await duck();
  const b = await duck();
  const watcher = await duck(b.code, "Watcher");
  let spawnedInB = 0;
  watcher.socket.on("krathong:spawned", () => spawnedInB++);

  const commandId = uuid();
  await carryToRiver(a);
  const inA = await release(a.socket, commandId);
  assert.ok(inA.ok);

  // The same user moves to room B and, by chance or on purpose, sends the same id again.
  assert.equal(errorCode(await ask(a.socket, "room:leave")), "OK");
  assert.equal(errorCode(await ask(a.socket, "room:join", { roomCode: b.code, displayName: "Sam", duckColor: "yellow" })), "OK");
  const moved = { ...a, code: b.code };
  await carryToRiver(moved);
  const inB = await release(a.socket, commandId);
  await wait(60);
  assert.ok(inB.ok);
  assert.notEqual(inB.ok && inB.data?.krathongId, inA.ok && inA.data?.krathongId, "a new krathong, not the old answer");
  assert.equal(spawnedInB, 1);
});

// --- Joining late and reconnecting ----------------------------------------------------------

test("someone who joins or reconnects sees the same krathongs, in the same places, as everyone else", async () => {
  const { duck, connect } = await start({}, { presenceGraceMs: 60_000 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const live: FloatingKrathong[] = [];
  bow.socket.on("krathong:spawned", ({ krathong }: { krathong: FloatingKrathong }) => live.push(krathong));
  const byId = (list: readonly FloatingKrathong[]) => [...list].sort((x, y) => x.id.localeCompare(y.id));

  await carryToRiver(sam, 0.3);
  await release(sam.socket);
  await wait(1900);
  await carryToRiver(sam, 0.6);
  await release(sam.socket);

  // Joining while the second one is still being set down: it is listed, and not yet on the water.
  const mia = await duck(sam.code, "Mia");
  assert.deepEqual(byId(mia.state.krathongs), byId(live), "exactly what the room was told, field for field");
  assert.ok(mia.state.krathongs.some((item) => item.createdAt > mia.state.serverTime));
  assert.ok(Math.abs(mia.state.serverTime - Date.now()) < 2000);
  // The same data and the same clock give the same place on every screen.
  const at = mia.state.serverTime + 5000;
  assert.deepEqual(byId(mia.state.krathongs).map((item) => krathongPosition(item, at)), byId(live).map((item) => krathongPosition(item, at)));

  // A dropped connection that comes back gets the same river again.
  bow.socket.disconnect();
  await wait(40);
  const again = await connect(bow.cookie);
  const snapshot = once<RoomState>(again, "room:snapshot");
  assert.equal(errorCode(await ask(again, "room:resume", { roomCode: sam.code })), "OK");
  assert.deepEqual(byId((await snapshot).krathongs), byId(live));
});

// --- Moving between rooms -------------------------------------------------------------------

test("a user who moves to another room gets nothing more from the old one", async () => {
  const { duck, connect } = await start({}, { presenceGraceMs: 60_000 });
  const a = await duck();
  const stays = await duck(a.code, "Stays");
  const b = await duck();
  const mover = await duck(a.code, "Mover");
  await walk(mover.socket, STALL);
  await pickup(mover.socket); // carrying a krathong in room A

  // 1. Leaving properly, then joining room B on the same connection.
  assert.equal(errorCode(await ask(mover.socket, "room:leave")), "OK");
  const inB = once<RoomState>(mover.socket, "room:snapshot");
  assert.equal(errorCode(await ask(mover.socket, "room:join", { roomCode: b.code, displayName: "Mover", duckColor: "yellow" })), "OK");
  const state = await inB;
  assert.equal(state.roomId, b.state.roomId);
  assert.equal(state.users.find((user) => user.id === mover.userId)?.carriedItem, undefined, "the krathong from room A did not come along");

  const seen = record(mover.socket);
  await carryToRiver(stays);
  await release(stays.socket); // in room A
  await ask(a.socket, "chat:message", { text: "still in A" });
  await wait(60);
  assert.equal(seen.length, 0, "nothing from room A");

  await carryToRiver(b);
  await release(b.socket); // in room B
  await wait(60);
  assert.equal(seen.filter((update) => update.event === "krathong:spawned").length, 1);
  assert.ok(seen.every((update) => update.roomVersion > state.version));

  // 2. The connection just drops (the duck stays in B as "away"), and a new one joins room A.
  mover.socket.disconnect();
  await wait(40);
  const fresh = await connect(mover.cookie);
  const freshSeen = record(fresh);
  assert.equal(errorCode(await ask(fresh, "room:join", { roomCode: a.code, displayName: "Mover", duckColor: "yellow" })), "OK");
  await wait(1900);
  await carryToRiver(b);
  await release(b.socket); // room B again
  await wait(60);
  assert.ok(freshSeen.every((update) => update.event !== "krathong:spawned"), "the new connection is in A and hears nothing from B");

  // A connection cannot sit in two rooms.
  assert.equal(errorCode(await ask(fresh, "room:join", { roomCode: b.code, displayName: "Mover", duckColor: "yellow" })), "CONFLICT");
});

// --- The event ends, a room closes, the server stops ---------------------------------------

test("when the festival ends, every room is cleared, each by its own messages", async () => {
  const s = await start();
  const rooms: Duck[][] = [];
  for (let r = 0; r < 3; r++) {
    const host = await s.duck();
    rooms.push([host, await s.duck(host.code, "Bow")]);
  }
  for (const [host, bow] of rooms) {
    await carryToRiver(host);
    await release(host.socket);
    await walk(bow.socket, STALL);
    await pickup(bow.socket); // still carrying when the festival ends
  }
  const seen = rooms.map(([host]) => record(host.socket));
  const before = await Promise.all(rooms.map(([host]) => snapshotOf(host)));

  s.clock.now = Date.now() + 2 * 3_600_000;
  s.events.tick();
  await wait(80);

  for (const [r, [host, bow]] of rooms.entries()) {
    const removed = seen[r].filter((update) => update.event === "krathong:removed");
    assert.deepEqual(removed.map((update) => update.krathongId), ids(before[r].krathongs), "its own krathong, and only that one");
    const dropped = seen[r].filter((update) => update.event === "duck:stateChanged");
    assert.deepEqual(dropped.map((update) => update.userId), [bow.userId]);
    assert.deepEqual(seen[r].map((update) => update.roomVersion), seen[r].map((_, i) => before[r].version + 1 + i));

    const after = await snapshotOf(host);
    assert.equal(after.krathongs.length, 0);
    assert.ok(after.users.every((user) => !user.carriedItem));
    assert.equal(errorCode(await pickup(host.socket)), "EVENT_INACTIVE");
    assert.equal(errorCode(await release(bow.socket)), "EVENT_INACTIVE");
  }
  // A second tick changes nothing and sends nothing.
  const counts = seen.map((updates) => updates.length);
  s.events.tick();
  await wait(40);
  assert.deepEqual(seen.map((updates) => updates.length), counts);
});

test("a closed room is gone once, with its timers, and other rooms are untouched", async () => {
  const s = await start({}, { emptyRoomTtlMs: 60, presenceGraceMs: 150, ownerGraceMs: 150 });
  const a = await s.duck();
  const a2 = await s.duck(a.code, "Bow");
  const b = await s.duck();
  await carryToRiver(a);
  await release(a.socket);
  await carryToRiver(b);
  await release(b.socket);

  // Both connections in room A drop. The ducks are held as "away", each with a timer running.
  a.socket.disconnect();
  a2.socket.disconnect();
  await wait(400); // longer than the room's time to live and both grace periods

  const about = (roomId: string) => s.entries.filter((entry) => entry.roomId === roomId).map((entry) => entry.event);
  assert.equal(about(a.state.roomId).filter((event) => event === "ROOM_DELETED").length, 1);
  assert.equal(about(a.state.roomId).at(-1), "ROOM_DELETED", "nothing happens in a room after it is deleted: its timers were stopped");
  assert.ok(!about(a.state.roomId).includes("OWNER_CHANGED"));

  const back = await s.connect(a.cookie);
  assert.equal(errorCode(await ask(back, "room:join", { roomCode: a.code, displayName: "Sam", duckColor: "yellow" })), "ROOM_NOT_FOUND");
  // Room B never noticed.
  assert.equal((await snapshotOf(b)).krathongs.length, 1);
  assert.ok(!about(b.state.roomId).includes("ROOM_DELETED"));
});

test("stopping the server stops every room timer", async () => {
  const s = await start({}, { emptyRoomTtlMs: 80, presenceGraceMs: 80, ownerGraceMs: 80 });
  const a = await s.duck();
  const a2 = await s.duck(a.code, "Bow");
  a2.socket.disconnect(); // one duck away, the owner still here
  await wait(20);
  await s.stop();
  server = undefined;
  const logged = s.entries.length;
  await wait(250);
  assert.equal(s.entries.length, logged, "no timer fired after the server stopped");
  void a;
});

// --- Walking there first ---------------------------------------------------------------------

test("a duck must reach the stall and the river before it can take or float a krathong", async () => {
  const { duck } = await start({}, { requireArrival: true });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  let spawned = 0;
  bow.socket.on("krathong:spawned", () => spawned++);
  const moved = (socket: Socket, to: { x: number; y: number }) =>
    once<{ durationMs: number }>(bow.socket, "duck:moved", () => walk(socket, to)).then((move) => move.durationMs);

  // On its way to the stall: the server already has the duck's destination, but the duck is not there yet.
  const toStall = await moved(sam.socket, STALL);
  assert.equal(errorCode(await pickup(sam.socket)), "TOO_FAR");
  await wait(toStall);
  assert.equal(errorCode(await pickup(sam.socket)), "OK");

  // Carrying it to the river: pressing "float" at once, mid-walk, does nothing.
  const toRiver = await moved(sam.socket, { x: 0.5, y: 0.85 });
  assert.ok(toRiver > 1000, "a long walk");
  const early = await release(sam.socket);
  assert.equal(errorCode(early), "TOO_FAR");
  await wait(60);
  assert.equal(spawned, 0);
  assert.ok((await snapshotOf(bow)).users.find((user) => user.id === sam.userId)?.carriedItem, "still carrying it");

  // A new destination mid-walk starts a new walk: the wait is counted again from now.
  await wait(toRiver / 2);
  const again = await moved(sam.socket, { x: 0.6, y: 0.9 });
  assert.equal(errorCode(await release(sam.socket)), "TOO_FAR");
  await wait(again);
  const done = await release(sam.socket);
  assert.equal(errorCode(done), "OK");
  await wait(60);
  assert.equal(spawned, 1);
  // The krathong starts where the duck really is.
  const state = await snapshotOf(bow);
  assert.equal(state.krathongs[0].startX, 0.6);
  assert.ok(!("arrivesAt" in state.users[0]), "the arrival time is the server's own note, not part of the shared state");
});

test("the browser may be a moment ahead of the server: arriving slightly early still counts", async () => {
  const { duck } = await start({}, { requireArrival: true });
  const sam = await duck();
  const walked = once<{ durationMs: number }>(sam.socket, "duck:moved", () => walk(sam.socket, STALL));
  const { durationMs } = await walked;
  await wait(durationMs - 200); // 200 ms before the server's own arrival time
  assert.equal(errorCode(await pickup(sam.socket)), "OK");
});

// --- The browser's side: which krathongs are on the river, and its timers --------------------

/** A clock the test moves by hand, so no real waiting is needed. */
const fakeClock = () => {
  let now = 1_000_000;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    count: () => timers.size,
    api: {
      set: (run: () => void, ms: number) => (timers.set(next, { at: now + Math.max(0, ms), run }), next++) as unknown as ReturnType<typeof setTimeout>,
      clear: (id: ReturnType<typeof setTimeout>) => void timers.delete(id as unknown as number),
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((x, y) => x[1].at - y[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
};
const krathong = (id: string, createdAt: number, lifeMs = 10_000): FloatingKrathong => ({
  id,
  ownerUserId: "owner",
  variant: "lotus-pink",
  startX: 0.5,
  startY: 0.7,
  driftX: 0.05,
  driftY: 0,
  driftSpeed: 0.6,
  createdAt,
  expiresAt: createdAt + lifeMs,
});
const timeline = (clock: ReturnType<typeof fakeClock>) => {
  const lists: string[][] = [];
  const river = createKrathongTimeline((afloat) => lists.push(afloat.map((item) => item.id)), clock.now, clock.api);
  return { river, lists, afloat: () => lists.at(-1) ?? [] };
};

test("browser: a krathong appears when it touches the water and goes when its time is up", () => {
  const clock = fakeClock();
  const { river, afloat } = timeline(clock);
  river.spawn(krathong("a", clock.now() + 800));
  assert.deepEqual(afloat(), [], "the duck is still setting it down");
  clock.advance(799);
  assert.deepEqual(afloat(), []);
  clock.advance(1);
  assert.deepEqual(afloat(), ["a"]);
  clock.advance(9_999);
  assert.deepEqual(afloat(), ["a"]);
  clock.advance(1);
  assert.deepEqual(afloat(), []);
  assert.equal(clock.count(), 0, "no timer left behind");
});

test("browser: several ducks at once, and the same krathong announced twice, give one entry each", () => {
  const clock = fakeClock();
  const { river, afloat } = timeline(clock);
  for (const id of ["a", "b", "c"]) river.spawn(krathong(id, clock.now() + 800));
  river.spawn(krathong("b", clock.now() + 800)); // a repeat
  assert.equal(river.pending(), 6, "two timers per krathong, not more");
  clock.advance(800);
  assert.deepEqual(afloat().sort(), ["a", "b", "c"]);
  clock.advance(10_000);
  assert.deepEqual(afloat(), []);
});

test("browser: a snapshot lists krathongs already afloat, ones not yet on the water, and none that are over", () => {
  const clock = fakeClock();
  const { river, afloat } = timeline(clock);
  river.reset([krathong("old", clock.now() - 9_000), krathong("new", clock.now() + 500), krathong("over", clock.now() - 20_000)]);
  assert.deepEqual(afloat(), ["old"]);
  clock.advance(500);
  assert.deepEqual(afloat(), ["old", "new"]);
  // The one from the snapshot also leaves on time, without any message.
  clock.advance(500);
  assert.deepEqual(afloat(), ["new"]);
});

test("browser: a krathong removed before it appears never appears (the festival ended while it was being set down)", () => {
  const clock = fakeClock();
  const { river, afloat, lists } = timeline(clock);
  river.spawn(krathong("a", clock.now() + 800));
  river.remove("a");
  river.remove("a"); // removing twice is fine
  clock.advance(60_000);
  assert.deepEqual(afloat(), []);
  assert.ok(lists.every((list) => !list.includes("a")));
  assert.equal(clock.count(), 0);
});

test("browser: a new snapshot or a new room forgets the old room's krathongs and their timers", () => {
  const clock = fakeClock();
  const { river, afloat } = timeline(clock);
  river.reset([krathong("room-a-1", clock.now() - 1000)]);
  river.spawn(krathong("room-a-2", clock.now() + 800)); // about to appear in room A

  river.reset([krathong("room-b-1", clock.now() - 1000)]); // the state was replaced
  assert.deepEqual(afloat(), ["room-b-1"]);
  clock.advance(5_000);
  assert.deepEqual(afloat(), ["room-b-1"], "room A's krathong did not turn up later");
  assert.equal(river.pending(), 1);
});

test("browser: leaving the room stops every timer and reports nothing more", () => {
  const clock = fakeClock();
  const { river, lists } = timeline(clock);
  river.reset([krathong("a", clock.now() - 1000)]);
  river.spawn(krathong("b", clock.now() + 800));
  const reports = lists.length;
  river.dispose();
  assert.equal(clock.count(), 0);
  clock.advance(60_000);
  assert.equal(lists.length, reports);
});

test("browser: two rooms open at once keep separate rivers", () => {
  const clock = fakeClock();
  const a = timeline(clock);
  const b = timeline(clock);
  a.river.spawn(krathong("a1", clock.now()));
  b.river.spawn(krathong("b1", clock.now()));
  b.river.spawn(krathong("b2", clock.now()));
  a.river.dispose(); // one tab leaves
  clock.advance(100);
  assert.deepEqual(a.afloat(), ["a1"], "its last report; nothing after it");
  assert.deepEqual(b.afloat(), ["b1", "b2"]);
});
