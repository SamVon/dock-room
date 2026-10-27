// Wearables: the server decides what a duck may wear, and only the worn outfit is shared.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { WEARABLES } from "../shared/cosmetics";
import type { DuckAppearance, RoomState } from "../shared/protocol";
import { ask, errorCode, once, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
const start = async (...args: Parameters<typeof startServer>) => (server = await startServer(...args));
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

type Appearance = { userId: string; appearance: DuckAppearance };
const equip = (socket: Parameters<typeof ask>[0], wearableId: string, slot = "head") => ask(socket, "cosmetic:equip", { slot, wearableId });

test("a user equips an item they own, and another player sees it", async () => {
  const { duck } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");

  const seen = once<Appearance>(owner.socket, "duck:appearance");
  assert.equal(errorCode(await equip(member.socket, "broken-egg")), "OK");
  const { userId, appearance } = await seen;
  assert.equal(userId, member.userId);
  assert.deepEqual(appearance, { color: "yellow", equipment: { head: "broken-egg", face: null, neck: null, back: null } });

  // Only the outfit is broadcast, never what the user owns.
  assert.deepEqual(Object.keys(appearance).sort(), ["color", "equipment"]);

  const cleared = once<Appearance>(owner.socket, "duck:appearance");
  assert.equal(errorCode(await ask(member.socket, "cosmetic:unequip", { slot: "head" })), "OK");
  assert.equal((await cleared).appearance.equipment.head, null);
});

test("unknown items, wrong slots and custom sprite URLs are rejected", async () => {
  const { duck } = await start();
  const { socket } = await duck();
  assert.equal(errorCode(await equip(socket, "laser-helmet")), "INVALID_PAYLOAD");
  assert.equal(errorCode(await equip(socket, "broken-egg", "back")), "INVALID_PAYLOAD"); // a head item in the back slot
  assert.equal(errorCode(await equip(socket, "broken-egg", "tail")), "INVALID_PAYLOAD"); // no such slot
  assert.equal(errorCode(await equip(socket, "https://evil.example/custom.png")), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(socket, "cosmetic:equip", { slot: "head", wearableId: "broken-egg", spriteUrl: "https://evil.example/custom.png" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(socket, "cosmetic:equip", { slot: "head", wearableId: "broken-egg", userId: "someone-else" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await equip(socket, "broken-egg")), "OK");
});

test("locked items cannot be equipped", async () => {
  const { duck } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");

  // Event items while their event is off.
  assert.equal(errorCode(await equip(member.socket, "santa-hat")), "FORBIDDEN");
  assert.equal(errorCode(await equip(member.socket, "racing-headband")), "FORBIDDEN");
  // The crown is for the room's leader; rare items are for sessions that hosted a room.
  assert.equal(errorCode(await equip(member.socket, "gold-crown")), "FORBIDDEN");
  assert.equal(errorCode(await equip(member.socket, "rainbow-cap")), "FORBIDDEN");
  assert.equal(errorCode(await equip(owner.socket, "gold-crown")), "OK");
  assert.equal(errorCode(await equip(owner.socket, "rainbow-cap")), "OK");

  assert.ok(!member.state.inventory.includes("gold-crown"));
  assert.ok(owner.state.inventory.includes("gold-crown"));
  assert.ok(member.state.inventory.includes("broken-egg"));
});

test("event items unlock while the event is on, and stay on once worn", async () => {
  const { duck } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");

  const unlocked = once<{ wearableIds: string[] }>(member.socket, "cosmetic:inventory");
  await ask(owner.socket, "room:scene", { scene: "festival" });
  assert.ok((await unlocked).wearableIds.includes("racing-headband"));
  assert.equal(errorCode(await equip(member.socket, "racing-headband")), "OK");

  // The festival ends: the headband is locked again, but a duck already wearing it keeps it.
  const locked = once<{ wearableIds: string[] }>(member.socket, "cosmetic:inventory");
  await ask(owner.socket, "room:scene", { scene: "valley" });
  assert.ok(!(await locked).wearableIds.includes("racing-headband"));
  assert.equal(errorCode(await equip(member.socket, "boat-captain-hat")), "FORBIDDEN");

  const late = await duck(owner.code, "Leo");
  assert.equal(late.state.users.find((user) => user.id === member.userId)?.equipment.head, "racing-headband");
});

test("the active seasonal event unlocks its hats, from its configuration", async () => {
  const christmas = {
    id: "evt-christmas",
    slug: "christmas",
    name: "Christmas",
    enabled: true,
    startAt: new Date(Date.now() - 3_600_000).toISOString(),
    endAt: new Date(Date.now() + 3_600_000).toISOString(),
    priority: 50,
    theme: { scene: "snowy-duck-village" },
    // An item from another season, listed as an accessory of this event, is unlocked too.
    ducks: { accessories: ["straw-hat", "heart-headband"] },
  };
  const { duck } = await start({}, {}, { events: [christmas] });
  const { socket, state } = await duck();
  assert.ok(state.inventory.includes("santa-hat"));
  assert.equal(errorCode(await equip(socket, "santa-hat")), "OK"); // belongs to the active event
  assert.equal(errorCode(await equip(socket, "heart-headband")), "OK"); // listed by the active event
  assert.equal(errorCode(await equip(socket, "witch-hat")), "FORBIDDEN"); // another event's item
});

test("reconnecting with the same session restores the outfit", async () => {
  const { duck, connect, url } = await start();
  const owner = await duck();
  await equip(owner.socket, "headphones");
  owner.socket.disconnect();

  // The dressing screen (before joining) already knows the saved outfit.
  const session = (await (await fetch(`${url}/api/session`, { headers: { cookie: owner.cookie } })).json()) as { equipment: { head: string } };
  assert.equal(session.equipment.head, "headphones");

  const again = await connect(owner.cookie);
  const state = once<RoomState>(again, "room:snapshot");
  await ask(again, "room:join", { roomCode: owner.code, displayName: "Sam", duckColor: "yellow" });
  assert.equal((await state).users.find((user) => user.id === owner.userId)?.equipment.head, "headphones");
});

test("an outfit asked for at join goes through the same checks", async () => {
  const { duck, visitor, connect } = await start();
  const owner = await duck();

  const join = async (equipment: unknown) => {
    const who = await visitor();
    const socket = await connect(who.cookie);
    const state = once<RoomState>(socket, "room:snapshot");
    const result = await ask(socket, "room:join", { roomCode: owner.code, displayName: "Mia", duckColor: "pink", equipment });
    return { result, head: result.ok ? (await state).users.find((user) => user.id === who.userId)?.equipment.head : undefined };
  };

  assert.equal((await join({ head: "blue-cap" })).head, "blue-cap");
  assert.equal((await join({ head: "gold-crown" })).head, null); // locked: quietly not worn
  assert.equal((await join({ head: "no-such-hat" })).head, null);
  assert.equal(errorCode((await join({ head: "blue-cap", spriteUrl: "https://evil.example/x.png" })).result), "INVALID_PAYLOAD");
});

test("the catalog is well formed", () => {
  assert.equal(new Set(WEARABLES.map((wearable) => wearable.id)).size, WEARABLES.length);
  for (const wearable of WEARABLES) {
    assert.match(wearable.id, /^[a-z0-9-]+$/);
    assert.equal(wearable.rarity === "event", !!wearable.eventId, wearable.id);
  }
  assert.ok(WEARABLES.length >= 25);
});
