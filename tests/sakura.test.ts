// The Sakura Festival is added as configuration. These tests check what an event may and may not change.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DEFAULT_EVENTS } from "../config/events";
import { FileEventRepository } from "../server/events";
import type { DuckAppearance, RoomMusicSettings, RoomState } from "../shared/protocol";
import type { StickerMatchPayload as StickerMatchEvent, StickerSentPayload as StickerSentEvent } from "../shared/protocol";
import { ask, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const HOUR = 3_600_000;
const sakura = DEFAULT_EVENTS.find((event) => event.slug === "sakura-festival")!;
const fastStickers = { sticker: { limit: 1000, windowMs: 1000 }, stickerSlow: { limit: 1000, windowMs: 1000 } };
/** A server whose calendar holds only the Sakura Festival, with the clock set just before it starts. */
const start = async () => {
  server = await startServer({ musicSharedCooldownMs: 0 }, fastStickers, { events: [sakura] });
  server.clock.now = Date.parse(sakura.startAt) - HOUR;
  server.events.tick();
  return server;
};
const begin = (s: Awaited<ReturnType<typeof start>>) => {
  s.clock.now = Date.parse(sakura.startAt) + HOUR;
  s.events.tick();
};
const finish = (s: Awaited<ReturnType<typeof start>>) => {
  s.clock.now = Date.parse(sakura.endAt) + HOUR;
  s.events.tick();
};

test("the Sakura Festival is in the calendar with its scene, music and accessories", () => {
  assert.equal(sakura.theme.scene, "sakura-duck-valley");
  assert.equal(sakura.theme.musicStation, "sakura-lofi");
  assert.ok(sakura.theme.decorations?.includes("sakuraTrees"));
  assert.ok(sakura.theme.particles?.includes("sakuraPetals"));
  assert.equal(sakura.ui?.icon, "🌸");
});

test("sakura stickers work only during the festival, and two of them match", async () => {
  const s = await start();
  const sam = await s.duck();
  const bow = await s.duck(sam.code, "Bow");

  assert.equal(errorCode(await ask(sam.socket, "sticker:send", { stickerId: "sakura" })), "EVENT_INACTIVE");
  assert.equal(errorCode(await ask(sam.socket, "sticker:send", { stickerId: "heart" })), "OK"); // everyday stickers are unaffected

  begin(s);
  const matched = once<StickerMatchEvent>(sam.socket, "sticker:match");
  assert.equal(errorCode(await ask(sam.socket, "sticker:send", { stickerId: "sakura" })), "OK");
  assert.equal(errorCode(await ask(bow.socket, "sticker:send", { stickerId: "sakura" })), "OK");
  const match = await matched;
  assert.equal(match.stickerId, "sakura");
  assert.ok(match.durationMs >= 2500 && match.durationMs <= 3500);

  finish(s);
  assert.equal(errorCode(await ask(bow.socket, "sticker:send", { stickerId: "tea" })), "EVENT_INACTIVE");
});

test("the festival unlocks its accessories, including the scarf in the neck slot", async () => {
  const s = await start();
  const sam = await s.duck();
  const bow = await s.duck(sam.code, "Bow");
  assert.equal(errorCode(await ask(bow.socket, "cosmetic:equip", { slot: "neck", wearableId: "spring-scarf" })), "FORBIDDEN");

  const unlocked = once<{ wearableIds: string[] }>(bow.socket, "cosmetic:inventory");
  begin(s);
  const inventory = (await unlocked).wearableIds;
  for (const id of ["sakura-flower-crown", "sakura-hair-clip", "pink-ribbon", "spring-scarf", "flower-garland"]) assert.ok(inventory.includes(id), id);

  const seen = once<{ appearance: DuckAppearance }>(sam.socket, "duck:appearance");
  assert.equal(errorCode(await ask(bow.socket, "cosmetic:equip", { slot: "neck", wearableId: "spring-scarf" })), "OK");
  assert.equal((await seen).appearance.equipment.neck, "spring-scarf");
  // Each item only fits its own slot, and the two slots are independent.
  assert.equal(errorCode(await ask(bow.socket, "cosmetic:equip", { slot: "head", wearableId: "spring-scarf" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(bow.socket, "cosmetic:equip", { slot: "neck", wearableId: "sakura-flower-crown" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(bow.socket, "cosmetic:equip", { slot: "head", wearableId: "sakura-flower-crown" })), "OK");

  const late = await s.duck(sam.code, "Mia");
  assert.deepEqual(late.state.users.find((user) => user.id === bow.userId)?.equipment, { head: "sakura-flower-crown", face: null, neck: "spring-scarf", back: null });
});

test("an event starting or ending leaves the room, its owner, its DJs, the chat and duck positions alone", async () => {
  const s = await start();
  const sam = await s.duck();
  const bow = await s.duck(sam.code, "Bow");
  await ask(sam.socket, "music:permission:setMode", { mode: "DJ_ONLY" });
  await ask(sam.socket, "music:permission:addDJ", { targetUserId: bow.userId });
  await ask(bow.socket, "duck:move", { destination: { x: 0.25, y: 0.75 } });
  await ask(sam.socket, "chat:message", { text: "before the festival" });

  let settingsChanges = 0;
  let ownerChanges = 0;
  let moves = 0;
  bow.socket.on("music:permissions", () => settingsChanges++);
  bow.socket.on("room:ownerChanged", () => ownerChanges++);
  bow.socket.on("duck:moved", () => moves++);

  begin(s);
  assert.equal(errorCode(await ask(bow.socket, "music:play")), "OK"); // Bow was a DJ and still is
  assert.equal(errorCode(await ask(bow.socket, "music:station", { stationId: "sakura-lofi" })), "OK"); // the festival's station is on the dial
  finish(s);
  assert.equal(errorCode(await ask(bow.socket, "music:pause")), "OK");
  await wait(60);
  assert.deepEqual([settingsChanges, ownerChanges, moves], [0, 0, 0]);

  const late = await s.duck(sam.code, "Mia");
  const state = late.state;
  assert.equal(state.ownerUserId, sam.userId);
  assert.deepEqual(state.musicSettings, { controlMode: "DJ_ONLY", djUserIds: [bow.userId] } satisfies RoomMusicSettings);
  assert.deepEqual(
    [state.users.find((user) => user.id === bow.userId)?.x, state.users.find((user) => user.id === bow.userId)?.y],
    [0.25, 0.75],
  );
  assert.ok(state.messages.some((message) => message.type === "user" && message.text === "before the festival"));
  assert.equal(state.music.stationId, "lofi"); // only the festival's own station was taken away
});

test("a saved events file picks up new built-in events, and keeps deletions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "duck-events-"));
  const file = path.join(dir, "events.json");
  const log = () => {};
  try {
    // An install that saved its events before the Sakura Festival existed (the older file format: a plain list).
    const older = DEFAULT_EVENTS.filter((event) => event.slug !== "sakura-festival").map((event) => (event.slug === "halloween" ? { ...event, name: "My Halloween" } : event));
    writeFileSync(file, JSON.stringify(older));

    const repo = new FileEventRepository(file, DEFAULT_EVENTS, log);
    assert.ok(repo.list().some((event) => event.slug === "sakura-festival"), "the new built-in event appears");
    assert.equal(repo.list().find((event) => event.slug === "halloween")?.name, "My Halloween", "the admin's own edits are kept");

    repo.delete("christmas");
    const reopened = new FileEventRepository(file, DEFAULT_EVENTS, log);
    assert.ok(!reopened.list().some((event) => event.slug === "christmas"), "a deleted built-in event stays deleted");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).removed, ["christmas"]);

    // A damaged file falls back to the built-in calendar instead of stopping the server.
    writeFileSync(file, "{ not json");
    assert.equal(new FileEventRepository(file, DEFAULT_EVENTS, log).list().length, DEFAULT_EVENTS.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
