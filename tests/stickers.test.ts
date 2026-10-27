// Matching stickers: the server notices two ducks sending the same sticker and pairs them.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Socket } from "socket.io-client";
import type { StickerMatchPayload as StickerMatchEvent, StickerSentPayload as StickerSentEvent } from "../shared/protocol";
import { ask, bare, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
// Stickers are normally limited to one a second; most tests lift that to stay fast.
const fast = { sticker: { limit: 1000, windowMs: 1000 }, stickerSlow: { limit: 1000, windowMs: 1000 } };
const start = async (overrides: Parameters<typeof startServer>[0] = {}, limits: Parameters<typeof startServer>[1] = fast) => (server = await startServer(overrides, limits));
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const send = (socket: Socket, stickerId: string) => ask(socket, "sticker:send", { stickerId });
/** Collects every match a socket hears about. */
const matches = (socket: Socket) => {
  const seen: StickerMatchEvent[] = [];
  socket.on("sticker:match", (event: StickerMatchEvent) => seen.push(event));
  return seen;
};

test("two different ducks sending the same sticker are matched by the server", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const watcher = await duck(sam.code, "Alex");

  const shown = once<StickerSentEvent>(bow.socket, "sticker:sent");
  assert.equal(errorCode(await send(sam.socket, "heart")), "OK");
  const { stickerEventId, createdAt, ...sent } = bare(await shown);
  assert.deepEqual(sent, { userId: sam.userId, stickerId: "heart" });
  assert.match(stickerEventId, /^[0-9a-f-]{36}$/);
  assert.ok(Math.abs(createdAt - Date.now()) < 5000);

  const forSam = once<StickerMatchEvent>(sam.socket, "sticker:match");
  const forWatcher = once<StickerMatchEvent>(watcher.socket, "sticker:match");
  const before = Date.now();
  assert.equal(errorCode(await send(bow.socket, "heart")), "OK");

  const match = await forSam;
  assert.deepEqual(await forWatcher, match); // everyone in the room gets the same event
  assert.equal(match.stickerId, "heart");
  assert.deepEqual([match.userA, match.userB], [sam.userId, bow.userId]); // first sender, then the one who completed it
  assert.ok(match.startedAt >= before + 100, "the start is a moment in the future");
  assert.ok(match.durationMs >= 2000 && match.durationMs <= 4000);
  assert.match(match.interactionId, /^[0-9a-f-]{36}$/);
});

test("a duck cannot match with itself", async () => {
  const { duck } = await start();
  const sam = await duck();
  const seen = matches(sam.socket);
  await send(sam.socket, "heart");
  await send(sam.socket, "heart");
  await wait(80);
  assert.equal(seen.length, 0);
});

test("different stickers do not match", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const seen = matches(sam.socket);
  await send(sam.socket, "heart");
  await send(bow.socket, "laugh");
  await wait(80);
  assert.equal(seen.length, 0);
});

test("stickers further apart than the time window do not match", async () => {
  const { duck } = await start({ stickers: { matchWindowMs: 120, pairCooldownMs: 0, startDelayMs: 20 } });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const seen = matches(sam.socket);

  await send(sam.socket, "heart");
  await wait(220);
  await send(bow.socket, "heart"); // too late for Sam's, but it is now waiting itself
  await wait(60);
  assert.equal(seen.length, 0);

  await send(sam.socket, "heart");
  await wait(60);
  assert.equal(seen.length, 1);
});

test("with three ducks, the first pair wins and the third stays free", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const alex = await duck(sam.code, "Alex");
  const mia = await duck(sam.code, "Mia");
  const seen = matches(sam.socket);

  await send(sam.socket, "heart");
  await send(bow.socket, "heart");
  await send(alex.socket, "heart");
  await wait(80);
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].userA, seen[0].userB], [sam.userId, bow.userId]);

  // Alex's heart is still waiting, so another free duck can match it.
  await send(mia.socket, "heart");
  await wait(80);
  assert.equal(seen.length, 2);
  assert.deepEqual([seen[1].userA, seen[1].userB], [alex.userId, mia.userId]);
});

test("ducks in an interaction are locked, and the same pair has a cooldown", async () => {
  const { duck } = await start({ stickers: { matchWindowMs: 3000, pairCooldownMs: 3000, startDelayMs: 20 } });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const alex = await duck(sam.code, "Alex");
  const seen = matches(alex.socket);

  await send(sam.socket, "fire");
  await send(bow.socket, "fire");
  await wait(60);
  assert.equal(seen.length, 1);

  // Hammering the same sticker does not start a second animation for the pair...
  await send(sam.socket, "fire");
  await send(bow.socket, "fire");
  // ...and a busy duck cannot be pulled into another interaction either.
  await send(alex.socket, "fire");
  await wait(80);
  assert.equal(seen.length, 1);
});

test("stickers are rate limited to one a second", async () => {
  const { duck } = await start({}, {});
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  let shown = 0;
  bow.socket.on("sticker:sent", () => shown++);

  const results = [await send(sam.socket, "heart"), await send(sam.socket, "heart"), await send(sam.socket, "heart")];
  await wait(60);
  assert.deepEqual(results.map(errorCode), ["OK", "RATE_LIMITED", "RATE_LIMITED"]);
  assert.equal(shown, 1); // a rejected sticker is never shown
});

test("unknown stickers and client-chosen partners are rejected", async () => {
  const { duck, visitor, connect } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const seen = matches(sam.socket);

  assert.equal(errorCode(await send(sam.socket, "explosion")), "INVALID_PAYLOAD");
  for (const extra of [{ userId: bow.userId }, { targetUserId: bow.userId }, { matchUserId: bow.userId }, { interactionType: "heart" }]) {
    assert.equal(errorCode(await ask(sam.socket, "sticker:send", { stickerId: "heart", ...extra })), "INVALID_PAYLOAD", JSON.stringify(extra));
  }
  // A client cannot announce a match itself.
  const error = once<{ error: { code: string } }>(sam.socket, "socket:error").then((sent) => sent.error);
  sam.socket.emit("sticker:match", { interactionId: "x", stickerId: "heart", userA: sam.userId, userB: bow.userId, startedAt: Date.now() });
  assert.equal((await error).code, "INVALID_PAYLOAD");
  await wait(60);
  assert.equal(seen.length, 0);

  // And only someone inside a room can send stickers at all.
  const outsider = await connect((await visitor()).cookie);
  assert.equal(errorCode(await send(outsider, "heart")), "NOT_IN_ROOM");
});

test("ducks that are close walk to meet, facing each other; movement waits until it ends", async () => {
  const { duck } = await start({ stickers: { matchWindowMs: 3000, pairCooldownMs: 0, startDelayMs: 20 } });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await ask(sam.socket, "duck:move", { destination: { x: 0.5, y: 0.4 } });
  await ask(bow.socket, "duck:move", { destination: { x: 0.4, y: 0.5 } });

  const matched = once<StickerMatchEvent>(sam.socket, "sticker:match");
  await send(sam.socket, "highfive");
  await send(bow.socket, "highfive");
  const match = await matched;

  assert.equal(match.mode, "together");
  const a = match.positions![sam.userId];
  const b = match.positions![bow.userId];
  assert.equal(a.y, b.y); // side by side
  assert.ok(Math.abs(a.y - 0.45) < 1e-9);
  assert.ok(b.x < a.x, "Bow was on the left and stays on the left");
  assert.ok(Math.abs(a.x - b.x - 0.09) < 1e-9, "a small gap between them");

  // A move during the animation is ignored, and nobody is told about one.
  let moved = 0;
  bow.socket.on("duck:moved", () => moved++);
  assert.equal(errorCode(await ask(sam.socket, "duck:move", { destination: { x: 0.9, y: 0.9 } })), "INVALID_STATE");
  await wait(60);
  assert.equal(moved, 0);

  // The new places are the real places: someone joining now sees them.
  const late = await duck(sam.code, "Mia");
  assert.deepEqual(
    late.state.users.filter((user) => user.id !== late.userId).map((user) => [user.x, user.y]).sort(),
    [[a.x, a.y], [b.x, b.y]].sort(),
  );
});

test("ducks that are far apart react where they stand", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await ask(sam.socket, "duck:move", { destination: { x: 0.1, y: 0.2 } });
  await ask(bow.socket, "duck:move", { destination: { x: 0.9, y: 0.8 } });

  const matched = once<StickerMatchEvent>(sam.socket, "sticker:match");
  await send(sam.socket, "sparkle");
  await send(bow.socket, "sparkle");
  const match = await matched;
  assert.equal(match.mode, "apart");
  assert.equal(match.positions, undefined);

  const late = await duck(sam.code, "Mia");
  assert.equal(late.state.users.find((user) => user.id === sam.userId)?.x, 0.1);
});

test("movement is free again after the interaction ends", async () => {
  const { duck } = await start({ stickers: { matchWindowMs: 3000, pairCooldownMs: 0, startDelayMs: 10 } });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const matched = once<StickerMatchEvent>(sam.socket, "sticker:match");
  await send(sam.socket, "highfive");
  await send(bow.socket, "highfive");
  const { durationMs } = await matched;

  await wait(durationMs + 80);
  const moved = once<{ userId: string }>(bow.socket, "duck:moved");
  await ask(sam.socket, "duck:move", { destination: { x: 0.7, y: 0.7 } });
  assert.equal((await moved).userId, sam.userId);
});
