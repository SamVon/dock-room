// Voice chat: the server keeps the list of who is in it and passes connection details between
// two ducks, and nobody else. The sound itself never reaches the server, so there is none here.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Socket } from "socket.io-client";
import type { RoomState, VoiceStatePayload } from "../shared/protocol";
import { VOICE_LIMITS, VoiceSignalSchema, type VoiceJoinResult, type VoiceSignal } from "../shared/voice";
import { securityHeaders } from "../server/http";
import { ask, bare, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
const start = async (...args: Parameters<typeof startServer>) => (server = await startServer(...args));
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const join = async (socket: Socket, muted = false) => {
  const result = await ask(socket, "voice:join", { muted });
  assert.equal(errorCode(result), "OK");
  return (result as unknown as { data: VoiceJoinResult }).data;
};
const offer: VoiceSignal = { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" };
/** The voice part of an update, without versions. */
const voiceState = (update: VoiceStatePayload) => {
  const { usersVersion: _usersVersion, ...content } = bare(update);
  return content;
};

test("joining tells the room, and the newcomer learns who to call", async () => {
  const { duck, config } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  assert.deepEqual(sam.state.voice, []);

  const seen = once<VoiceStatePayload>(bow.socket, "voice:state");
  const first = await join(sam.socket);
  assert.deepEqual(first.peers, [], "nobody to call yet");
  assert.deepEqual(first.iceServers, config.iceServers);
  assert.deepEqual(voiceState(await seen), { userId: sam.userId, joined: true, muted: false });

  // The second duck is told about the first, and calls it. The first is never told to call anyone.
  assert.deepEqual((await join(bow.socket, true)).peers, [sam.userId]);

  // A duck that arrives later sees the voice chat in its snapshot.
  const alex = await duck(sam.code, "Alex");
  assert.deepEqual(
    alex.state.voice.toSorted((a, b) => a.userId.localeCompare(b.userId)),
    [
      { userId: sam.userId, muted: false },
      { userId: bow.userId, muted: true },
    ].toSorted((a, b) => a.userId.localeCompare(b.userId)),
  );
});

test("a signal reaches the duck it is for and nobody else, and the server says who it is from", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const alex = await duck(sam.code, "Alex");
  for (const who of [sam, bow, alex]) await join(who.socket);

  let overheard = 0;
  alex.socket.on("voice:signal", () => overheard++);
  sam.socket.on("voice:signal", () => overheard++);

  const arrived = once<{ from: string; signal: VoiceSignal }>(bow.socket, "voice:signal");
  assert.equal(errorCode(await ask(sam.socket, "voice:signal", { to: bow.userId, signal: offer })), "OK");
  assert.deepEqual(await arrived, { from: sam.userId, signal: offer });

  const paths: VoiceSignal = { type: "candidates", candidates: [{ candidate: "candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host", sdpMid: "0", sdpMLineIndex: 0 }] };
  const more = once<{ from: string; signal: VoiceSignal }>(sam.socket, "voice:signal");
  assert.equal(errorCode(await ask(bow.socket, "voice:signal", { to: sam.userId, signal: paths })), "OK");
  assert.deepEqual(await more, { from: bow.userId, signal: paths });

  await wait(60);
  assert.equal(overheard, 1, "only the answer to Sam; Alex heard nothing");
});

test("signals only travel between two ducks who are both in this room's voice chat", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const stranger = await duck(undefined, "Eve"); // another room
  await join(stranger.socket);

  let delivered = 0;
  for (const who of [sam, bow, stranger]) who.socket.on("voice:signal", () => delivered++);
  const send = (from: Socket, to: string) => ask(from, "voice:signal", { to, signal: offer }).then(errorCode);

  assert.equal(await send(sam.socket, bow.userId), "OBJECT_NOT_FOUND", "the sender is not in the voice chat");
  await join(sam.socket);
  assert.equal(await send(sam.socket, bow.userId), "OBJECT_NOT_FOUND", "the target is not in the voice chat");
  assert.equal(await send(sam.socket, sam.userId), "OBJECT_NOT_FOUND", "not to yourself");
  assert.equal(await send(sam.socket, stranger.userId), "OBJECT_NOT_FOUND", "not into another room");
  assert.equal(await send(stranger.socket, sam.userId), "OBJECT_NOT_FOUND", "nor out of one");

  await wait(60);
  assert.equal(delivered, 0);
});

test("a signal is checked like every other payload: no claimed sender, no oversized or made-up content", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  await join(sam.socket);
  await join(bow.socket);
  let delivered = 0;
  bow.socket.on("voice:signal", () => delivered++);

  const bad: unknown[] = [
    { to: bow.userId, signal: offer, from: bow.userId },
    { to: bow.userId, signal: { ...offer, userId: bow.userId } },
    { to: bow.userId, signal: { type: "offer", sdp: "x".repeat(VOICE_LIMITS.sdp + 1) } },
    { to: bow.userId, signal: { type: "bye" } },
    { to: bow.userId, signal: { type: "candidates", candidates: [] } },
    { to: bow.userId, signal: { type: "candidates", candidates: Array(VOICE_LIMITS.candidatesPerSignal + 1).fill({ candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 }) } },
    { to: "bow", signal: offer },
    { signal: offer },
  ];
  for (const payload of bad) {
    assert.ok(!VoiceSignalSchema.safeParse(payload).success, JSON.stringify(payload).slice(0, 80));
    assert.equal(errorCode(await ask(sam.socket, "voice:signal", payload)), "INVALID_PAYLOAD");
  }
  await wait(60);
  assert.equal(delivered, 0);
});

test("the microphone switch is the sender's own, and only works in the voice chat", async () => {
  const { duck } = await start();
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  assert.equal(errorCode(await ask(sam.socket, "voice:mute", { muted: true })), "INVALID_STATE");
  await once<VoiceStatePayload>(bow.socket, "voice:state", () => join(sam.socket));

  const seen = once<VoiceStatePayload>(bow.socket, "voice:state");
  assert.equal(errorCode(await ask(sam.socket, "voice:mute", { muted: true })), "OK");
  assert.deepEqual(voiceState(await seen), { userId: sam.userId, joined: true, muted: true });
  // Nobody can name another duck to mute.
  assert.equal(errorCode(await ask(bow.socket, "voice:mute", { muted: true, userId: sam.userId })), "INVALID_PAYLOAD");
});

test("the voice chat has its own, smaller limit", async () => {
  const { duck } = await start({ maxVoiceUsers: 2 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const alex = await duck(sam.code, "Alex");
  await join(sam.socket);
  await join(bow.socket);
  assert.equal(errorCode(await ask(alex.socket, "voice:join", { muted: false })), "ROOM_FULL");
  // Someone already in can start over (a new microphone, a broken connection) without losing the place.
  assert.deepEqual((await join(bow.socket)).peers, [sam.userId]);
  assert.equal(errorCode(await ask(sam.socket, "voice:leave")), "OK");
  assert.deepEqual((await join(alex.socket)).peers, [bow.userId]);
});

test("leaving the voice chat, leaving the room and losing the connection all end it", async () => {
  const { duck } = await start({ presenceGraceMs: 60_000 });
  const sam = await duck();
  const bow = await duck(sam.code, "Bow");
  const alex = await duck(sam.code, "Alex");
  const watcher = await duck(sam.code, "Kim");
  for (const who of [sam, bow, alex]) await join(who.socket);

  const left = (userId: string, trigger: () => unknown) =>
    new Promise<void>((resolve) => {
      const listener = (update: VoiceStatePayload) => {
        if (update.userId !== userId || update.joined) return;
        watcher.socket.off("voice:state", listener);
        resolve();
      };
      watcher.socket.on("voice:state", listener);
      trigger();
    });

  await left(sam.userId, () => ask(sam.socket, "voice:leave"));
  await left(bow.userId, () => ask(bow.socket, "room:leave"));
  // Alex's connection drops. The duck is kept in the room for a while, but its voice is gone at once.
  await left(alex.userId, () => alex.socket.disconnect());

  const state = once<RoomState>(watcher.socket, "room:snapshot");
  await ask(watcher.socket, "room:resync", { roomCode: sam.code, reason: "MANUAL" });
  const { voice, users } = await state;
  assert.deepEqual(voice, []);
  assert.ok(users.some((user) => user.id === alex.userId && !user.connected), "the duck itself is still held");
});

test("the microphone is allowed for our own pages only", async () => {
  const { config } = await start();
  assert.match(securityHeaders(config)["Permissions-Policy"], /(^|, )microphone=\(self\)(,|$)/);
  assert.match(securityHeaders(config)["Permissions-Policy"], /camera=\(\)/);
});
