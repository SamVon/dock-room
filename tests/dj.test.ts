// DJ mode: who may control the shared radio is a room setting, checked by the server on every command.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { MusicState, RoomMusicSettings } from "../shared/protocol";
import { ask, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
// Most tests are about permission, not pace, so the music limits are lifted unless a test sets them.
const roomy = { limit: 1000, windowMs: 1000 };
const open = { musicToggle: roomy, musicStation: roomy, musicNext: roomy, requestDJ: roomy };
const start = async (overrides: Parameters<typeof startServer>[0] = { musicSharedCooldownMs: 0 }, limits: Parameters<typeof startServer>[1] = open) =>
  (server = await startServer(overrides, limits));
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const room = async () => {
  const { duck } = await start();
  const owner = await duck();
  const bow = await duck(owner.code, "Bow");
  const alex = await duck(owner.code, "Alex");
  return { owner, bow, alex, duck };
};
const setMode = (socket: Parameters<typeof ask>[0], mode: string) => ask(socket, "music:permission:setMode", { mode });

test("a new room is owner-only: the owner controls music, members cannot", async () => {
  const { owner, bow } = await room();
  assert.deepEqual(bow.state.musicSettings, { controlMode: "OWNER_ONLY", djUserIds: [] });
  assert.equal(errorCode(await ask(owner.socket, "music:play")), "OK");
  for (const event of ["music:play", "music:pause", "music:next"]) assert.equal(errorCode(await ask(bow.socket, event)), "FORBIDDEN", event);
  assert.equal(errorCode(await ask(bow.socket, "music:station", { stationId: "jazz" })), "FORBIDDEN");
});

test("in DJ mode, DJs control music and ordinary members do not", async () => {
  const { owner, bow, alex } = await room();
  const settings = once<{ mode: RoomMusicSettings["controlMode"]; djUserIds: string[] }>(alex.socket, "music:permissions").then(({ mode, djUserIds }) => ({ controlMode: mode, djUserIds }));
  assert.equal(errorCode(await setMode(owner.socket, "DJ_ONLY")), "OK");
  assert.equal((await settings).controlMode, "DJ_ONLY");

  // DJ mode alone gives nobody control until the owner names a DJ.
  assert.equal(errorCode(await ask(bow.socket, "music:play")), "FORBIDDEN");

  const granted = once<{ mode: RoomMusicSettings["controlMode"]; djUserIds: string[] }>(alex.socket, "music:permissions").then(({ mode, djUserIds }) => ({ controlMode: mode, djUserIds }));
  assert.equal(errorCode(await ask(owner.socket, "music:permission:addDJ", { targetUserId: bow.userId })), "OK");
  assert.deepEqual((await granted).djUserIds, [bow.userId]);

  const changed = once<{ state: MusicState }>(alex.socket, "music:state").then((update) => update.state);
  assert.equal(errorCode(await ask(bow.socket, "music:play")), "OK");
  const state = await changed;
  assert.equal(state.playing, true);
  assert.equal(state.changedByUserId, bow.userId); // the server records who did it
  assert.equal(errorCode(await ask(bow.socket, "music:station", { stationId: "jazz" })), "OK");
  assert.equal(errorCode(await ask(alex.socket, "music:play")), "FORBIDDEN");
  assert.equal(errorCode(await ask(owner.socket, "music:pause")), "OK"); // the owner always can

  assert.equal(errorCode(await ask(owner.socket, "music:permission:removeDJ", { targetUserId: bow.userId })), "OK");
  assert.equal(errorCode(await ask(bow.socket, "music:play")), "FORBIDDEN");
});

test("being listed as a DJ does nothing while the room is owner-only", async () => {
  const { owner, bow } = await room();
  await ask(owner.socket, "music:permission:addDJ", { targetUserId: bow.userId });
  assert.equal(errorCode(await ask(bow.socket, "music:play")), "FORBIDDEN");
});

test("in everyone mode any member controls music, and each change raises the version", async () => {
  const { owner, bow, alex } = await room();
  await setMode(owner.socket, "EVERYONE");
  const versions: number[] = [];
  owner.socket.on("music:state", ({ state }: { state: MusicState }) => versions.push(state.version));

  assert.equal(errorCode(await ask(bow.socket, "music:play")), "OK");
  assert.equal(errorCode(await ask(alex.socket, "music:next")), "OK");
  assert.equal(errorCode(await ask(bow.socket, "music:pause")), "OK");
  await wait(60);
  assert.deepEqual(versions, [versions[0], versions[0] + 1, versions[0] + 2]);

  await setMode(owner.socket, "OWNER_ONLY");
  assert.equal(errorCode(await ask(bow.socket, "music:play")), "FORBIDDEN");
});

test("only the owner changes permissions: a DJ cannot appoint DJs or change the mode", async () => {
  const { owner, bow, alex } = await room();
  await setMode(owner.socket, "DJ_ONLY");
  await ask(owner.socket, "music:permission:addDJ", { targetUserId: bow.userId });

  assert.equal(errorCode(await ask(bow.socket, "music:permission:addDJ", { targetUserId: alex.userId })), "FORBIDDEN");
  assert.equal(errorCode(await ask(bow.socket, "music:permission:removeDJ", { targetUserId: bow.userId })), "FORBIDDEN");
  assert.equal(errorCode(await setMode(bow.socket, "EVERYONE")), "FORBIDDEN");
  assert.equal(errorCode(await setMode(alex.socket, "EVERYONE")), "FORBIDDEN");
  assert.equal(errorCode(await ask(alex.socket, "music:play")), "FORBIDDEN");
});

test("claims of being the owner or a DJ in a payload are rejected", async () => {
  const { owner, bow } = await room();
  for (const claim of [{ isOwner: true }, { role: "DJ" }, { userId: owner.userId }, { djUserIds: [bow.userId] }]) {
    assert.equal(errorCode(await ask(bow.socket, "music:play", claim)), "INVALID_PAYLOAD", JSON.stringify(claim));
  }
  assert.equal(errorCode(await ask(bow.socket, "music:station", { stationId: "jazz", role: "DJ" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(owner.socket, "music:permission:setMode", { mode: "ANARCHY" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(owner.socket, "music:permission:addDJ", { targetUserId: "not-a-user-id" })), "INVALID_PAYLOAD");
  // Someone who is not in the room cannot be made a DJ.
  assert.equal(errorCode(await ask(owner.socket, "music:permission:addDJ", { targetUserId: "11111111-1111-4111-8111-111111111111" })), "OBJECT_NOT_FOUND");
  // A client cannot announce new settings itself.
  const error = once<{ error: { code: string } }>(bow.socket, "socket:error").then((sent) => sent.error);
  bow.socket.emit("music:permissions", { mode: "EVERYONE", djUserIds: [bow.userId] });
  assert.equal((await error).code, "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(bow.socket, "music:play")), "FORBIDDEN");
});

test("rapid station switching is rate limited", async () => {
  const { duck } = await start({ musicSharedCooldownMs: 0 }, {});
  const owner = await duck();
  const stations = ["jazz", "rain", "piano", "lofi", "jazz"];
  const results = [];
  for (const stationId of stations) results.push(errorCode(await ask(owner.socket, "music:station", { stationId })));
  assert.deepEqual(results, ["OK", "OK", "OK", "RATE_LIMITED", "RATE_LIMITED"]);

  const skips = [];
  for (let i = 0; i < 5; i++) skips.push(errorCode(await ask(owner.socket, "music:next")));
  assert.deepEqual(skips, ["OK", "OK", "OK", "RATE_LIMITED", "RATE_LIMITED"]);
});

test("when members share the radio, their changes are spaced out; the owner is not held back", async () => {
  const { duck } = await start({ musicSharedCooldownMs: 300 });
  const owner = await duck();
  const bow = await duck(owner.code, "Bow");
  const alex = await duck(owner.code, "Alex");
  await setMode(owner.socket, "EVERYONE");

  assert.equal(errorCode(await ask(bow.socket, "music:next")), "OK");
  assert.equal(errorCode(await ask(alex.socket, "music:next")), "RATE_LIMITED"); // too soon after Bow
  assert.equal(errorCode(await ask(owner.socket, "music:next")), "OK");
  await wait(350);
  assert.equal(errorCode(await ask(alex.socket, "music:next")), "OK");
});

test("a DJ keeps the role after reconnecting, and after the owner changes", async () => {
  const { duck, connect } = await start({ musicSharedCooldownMs: 0, ownerGraceMs: 60 });
  const owner = await duck();
  const bow = await duck(owner.code, "Bow");
  const alex = await duck(owner.code, "Alex");
  await setMode(owner.socket, "DJ_ONLY");
  await ask(owner.socket, "music:permission:addDJ", { targetUserId: alex.userId });

  alex.socket.disconnect();
  const again = await connect(alex.cookie);
  await ask(again, "room:join", { roomCode: owner.code, displayName: "Alex", duckColor: "yellow" });
  assert.equal(errorCode(await ask(again, "music:play")), "OK");

  // The owner leaves for good: Bow, the longest-connected member, takes over with full control.
  const changed = once<{ ownerUserId: string }>(bow.socket, "room:ownerChanged");
  owner.socket.disconnect();
  assert.equal((await changed).ownerUserId, bow.userId);
  assert.equal(errorCode(await ask(bow.socket, "music:pause")), "OK");
  assert.equal(errorCode(await ask(bow.socket, "music:permission:removeDJ", { targetUserId: alex.userId })), "OK");
  assert.equal(errorCode(await ask(again, "music:play")), "FORBIDDEN");
});

test("a member can ask to be a DJ; only the owner hears it", async () => {
  const { owner, bow, alex } = await room();
  let heardByAlex = 0;
  alex.socket.on("music:djRequest", () => heardByAlex++);
  const request = once<{ userId: string }>(owner.socket, "music:djRequest");
  assert.equal(errorCode(await ask(bow.socket, "music:requestDJ")), "OK");
  assert.equal((await request).userId, bow.userId);
  await wait(60);
  assert.equal(heardByAlex, 0);
  // Asking is not getting: nothing changed.
  assert.equal(errorCode(await ask(bow.socket, "music:play")), "FORBIDDEN");
});

test("requests for DJ access are rate limited", async () => {
  const { duck } = await start({ musicSharedCooldownMs: 0 }, {});
  const owner = await duck();
  const bow = await duck(owner.code, "Bow");
  assert.equal(errorCode(await ask(bow.socket, "music:requestDJ")), "OK");
  assert.equal(errorCode(await ask(bow.socket, "music:requestDJ")), "RATE_LIMITED");
});
