// Attacks a real running server the way a malicious client would: by sending whatever it likes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { ChatMessage, MusicState, RoomState } from "../shared/protocol";
import { ChatTextSchema, DisplayNameSchema, LIMITS, ROOM_CODE_ALPHABET } from "../shared/protocol";
import { ask, bare, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
const start = async (...args: Parameters<typeof startServer>) => (server = await startServer(...args));
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

// --- Identity and sessions ---------------------------------------------------

test("session cookie is HttpOnly, SameSite=Strict and not readable as a plain id", async () => {
  const { visitor } = await start();
  const { setCookie, userId } = await visitor();
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(userId, /^[0-9a-f-]{36}$/);
});

test("a socket without a session, or with a forged one, is refused", async () => {
  const { visitor, connect } = await start();
  await assert.rejects(connect(undefined), /UNAUTHENTICATED/);

  const [me, victim] = [await visitor(), await visitor()];
  // Pretend to be the victim: swap their user id into our own signed cookie.
  const forged = me.cookie.replace(me.userId, victim.userId);
  await assert.rejects(connect(forged), /UNAUTHENTICATED/);
});

test("reconnecting with the same session restores identity and ownership", async () => {
  const { duck, connect } = await start();
  const owner = await duck();
  owner.socket.disconnect();

  const again = await connect(owner.cookie);
  const state = once<RoomState>(again, "room:snapshot");
  await ask(again, "room:join", { roomCode: owner.code, displayName: "Sam", duckColor: "yellow" });
  const { selfId, ownerUserId } = await state;
  assert.equal(selfId, owner.userId);
  assert.equal(ownerUserId, owner.userId);
});

// --- Rooms and ownership -----------------------------------------------------

test("the creator becomes owner and a later joiner does not", async () => {
  const { duck } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");
  assert.equal(owner.state.ownerUserId, owner.userId);
  assert.equal(member.state.ownerUserId, owner.userId);
  assert.notEqual(member.userId, owner.userId);
});

test("room codes are server-made, unique and from the safe alphabet", async () => {
  const { visitor, createRoom } = await start();
  const { cookie } = await visitor();
  const codes = await Promise.all(Array.from({ length: 50 }, () => createRoom(cookie)));
  assert.equal(new Set(codes).size, 50);
  for (const code of codes) {
    assert.equal(code.length, LIMITS.roomCode);
    assert.ok([...code].every((char) => ROOM_CODE_ALPHABET.includes(char)));
  }
});

test("creating a room needs a session, our origin and the custom header", async () => {
  const { url, visitor } = await start();
  const { cookie } = await visitor();
  const post = (headers: Record<string, string>) => fetch(`${url}/api/rooms`, { method: "POST", headers });
  assert.equal((await post({ "x-duck-room": "1" })).status, 401);
  assert.equal((await post({ cookie })).status, 401);
  assert.equal((await post({ cookie, "x-duck-room": "1", origin: "https://evil.example" })).status, 401);
  assert.equal((await post({ cookie, "x-duck-room": "1" })).status, 201);
});

test("room creation is rate limited", async () => {
  const { url, visitor } = await start({}, { createRoom: { limit: 5, windowMs: 60_000 } });
  const { cookie } = await visitor();
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await fetch(`${url}/api/rooms`, { method: "POST", headers: { cookie, "x-duck-room": "1" } })).status);
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429, 429]);
});

test("an invalid or unknown room code is rejected with a generic answer", async () => {
  const { visitor, connect } = await start();
  const socket = await connect((await visitor()).cookie);
  const join = (code: unknown) => ask(socket, "room:join", { roomCode: code, displayName: "Sam", duckColor: "yellow" });
  assert.equal(errorCode(await join("nope")), "INVALID_PAYLOAD");
  assert.equal(errorCode(await join("../../etc")), "INVALID_PAYLOAD");
  assert.equal(errorCode(await join(12345678)), "INVALID_PAYLOAD");
  assert.equal(errorCode(await join("ABCDEFGH")), "ROOM_NOT_FOUND");
});

test("join attempts are rate limited, which slows down guessing room codes", async () => {
  const { visitor, connect } = await start({}, { join: { limit: 3, windowMs: 60_000 } });
  const socket = await connect((await visitor()).cookie);
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push(errorCode(await ask(socket, "room:join", { roomCode: "ABCDEFGH", displayName: "Sam", duckColor: "yellow" })));
  assert.deepEqual(codes, ["ROOM_NOT_FOUND", "ROOM_NOT_FOUND", "ROOM_NOT_FOUND", "RATE_LIMITED", "RATE_LIMITED"]);
});

test("a full room refuses more users", async () => {
  const { duck } = await start({ maxRoomUsers: 2 });
  const owner = await duck();
  await duck(owner.code, "Mia");
  await assert.rejects(duck(owner.code, "Leo"), /ROOM_FULL/);
});

test("client-sent isOwner or userId is rejected and gives no rights", async () => {
  const { duck, visitor, connect } = await start();
  const owner = await duck();
  const socket = await connect((await visitor()).cookie);
  const base = { roomCode: owner.code, displayName: "Eve", duckColor: "yellow" };
  assert.equal(errorCode(await ask(socket, "room:join", { ...base, isOwner: true })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(socket, "room:join", { ...base, userId: owner.userId })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(socket, "room:join", { ...base, role: "owner" })), "INVALID_PAYLOAD");

  const state = once<RoomState>(socket, "room:snapshot");
  assert.equal(errorCode(await ask(socket, "room:join", base)), "OK");
  assert.equal((await state).ownerUserId, owner.userId);
  assert.equal(errorCode(await ask(socket, "music:play")), "FORBIDDEN");
});

test("an invalid duck color or display name is rejected", async () => {
  const { duck, visitor, connect } = await start();
  const owner = await duck();
  const socket = await connect((await visitor()).cookie);
  const join = (extra: object) => ask(socket, "room:join", { roomCode: owner.code, displayName: "Eve", duckColor: "yellow", ...extra });
  assert.equal(errorCode(await join({ duckColor: "red; background:url(https://evil.example)" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await join({ duckColor: "#ff0000" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await join({ displayName: "   " })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await join({ displayName: "x".repeat(25) })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await join({ displayName: "Eve\u0000‮" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await join({ displayName: "ສົມໃຈ 🦆" })), "OK");
});

test("when the owner does not come back, the longest-connected member becomes owner", async () => {
  const { duck } = await start({ ownerGraceMs: 80 });
  const owner = await duck();
  const first = await duck(owner.code, "Mia");
  await wait(5);
  const second = await duck(owner.code, "Leo");

  const changed = once<{ ownerUserId: string }>(second.socket, "room:ownerChanged");
  owner.socket.disconnect();
  assert.equal((await changed).ownerUserId, first.userId);
  assert.equal(errorCode(await ask(first.socket, "music:play")), "OK");
  assert.equal(errorCode(await ask(second.socket, "music:play")), "FORBIDDEN");
});

test("an owner who returns within the grace period keeps the room", async () => {
  const { duck, connect } = await start({ ownerGraceMs: 150 });
  const owner = await duck();
  const member = await duck(owner.code, "Mia");
  owner.socket.disconnect();

  const again = await connect(owner.cookie);
  await ask(again, "room:join", { roomCode: owner.code, displayName: "Sam", duckColor: "yellow" });
  await wait(250);
  assert.equal(errorCode(await ask(again, "music:play")), "OK");
  assert.equal(errorCode(await ask(member.socket, "music:pause")), "FORBIDDEN");
});

test("an empty room is deleted after its TTL", async () => {
  const { duck, visitor, connect, logs } = await start({ emptyRoomTtlMs: 60 });
  const owner = await duck();
  owner.socket.disconnect();
  await wait(150);
  const socket = await connect((await visitor()).cookie);
  assert.equal(errorCode(await ask(socket, "room:join", { roomCode: owner.code, displayName: "Mia", duckColor: "pink" })), "ROOM_NOT_FOUND");
  assert.ok(logs.includes("ROOM_DELETED"));
});

// --- Movement ----------------------------------------------------------------

test("a member cannot move another duck", async () => {
  const { duck } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");

  assert.equal(errorCode(await ask(member.socket, "duck:move", { userId: owner.userId, x: 0.5, y: 0.5 })), "INVALID_PAYLOAD");

  const moved = once<{ userId: string }>(owner.socket, "duck:moved");
  assert.equal(errorCode(await ask(member.socket, "duck:move", { destination: { x: 0.5, y: 0.5 } })), "OK");
  assert.equal((await moved).userId, member.userId);
});

test("malformed movement coordinates are rejected", async () => {
  const { duck } = await start();
  const { socket } = await duck();
  const bad = [{ x: -0.1, y: 0.5 }, { x: 0.5, y: 1.01 }, { x: 1e308, y: 0 }, { x: "0.5", y: 0.5 }, { x: null, y: 0.5 }, { x: 0.5 }, [0.5, 0.5], "0.5,0.5", null];
  for (const payload of bad) assert.equal(errorCode(await ask(socket, "duck:move", payload)), "INVALID_PAYLOAD", JSON.stringify(payload));
  // NaN and Infinity cannot even be sent as JSON: they arrive as null.
  assert.equal(errorCode(await ask(socket, "duck:move", { destination: { x: Number.NaN, y: Number.POSITIVE_INFINITY } })), "INVALID_PAYLOAD");
});

test("a movement flood is throttled", async () => {
  const { duck } = await start();
  const { socket } = await duck();
  let moved = 0;
  socket.on("duck:moved", () => moved++);
  for (let i = 0; i < 80; i++) socket.emit("duck:move", { clientMoveId: randomUUID(), destination: { x: Math.random(), y: Math.random() } });
  await wait(300);
  assert.equal(moved, 20);
});

test("a duck can hold only allowed items, and only changes its own", async () => {
  const { duck } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");
  assert.equal(member.state.users.find((user) => user.id === member.userId)?.heldItem, "none");

  const seen = once<{ userId: string; heldItem: string }>(owner.socket, "duck:item");
  assert.equal(errorCode(await ask(member.socket, "duck:item", { heldItem: "sword" })), "OK");
  assert.deepEqual({ ...bare(await seen), usersVersion: 0 }, { userId: member.userId, heldItem: "sword", usersVersion: 0 });

  assert.equal(errorCode(await ask(member.socket, "duck:item", { heldItem: "bazooka" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(member.socket, "duck:item", { heldItem: "url(https://evil.example/x.png)" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(member.socket, "duck:item", { userId: owner.userId, heldItem: "gun" })), "INVALID_PAYLOAD");

  // A newcomer sees what everyone is holding.
  const late = await duck(owner.code, "Leo");
  assert.equal(late.state.users.find((user) => user.id === member.userId)?.heldItem, "sword");
});

// --- Chat --------------------------------------------------------------------

test("a 300-character message is accepted and a 301-character one is rejected", async () => {
  const { duck } = await start();
  const { socket } = await duck();
  assert.equal(errorCode(await ask(socket, "chat:message", { text: "a".repeat(300) })), "OK");
  assert.equal(errorCode(await ask(socket, "chat:message", { text: "a".repeat(301) })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(socket, "chat:message", { text: "   " })), "INVALID_PAYLOAD");
});

test("HTML and script in chat stay plain text, and no page renders raw HTML", async () => {
  const { duck } = await start();
  const { socket } = await duck();
  const attack = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
  const received = once<{ message: ChatMessage }>(socket, "chat:message").then((update) => update.message);
  await ask(socket, "chat:message", { text: attack });
  assert.equal((await received).text, attack); // delivered unchanged, as text

  // React escapes text by default; the only way to break that is dangerouslySetInnerHTML.
  const sources = ["app", "components"].flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => readFileSync(path.join(dir, file), "utf8")),
  );
  assert.ok(sources.length > 3);
  for (const source of sources) assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML/);
});

test("the server decides who sent a message", async () => {
  const { duck } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");
  const spoof = { text: "hi", userId: owner.userId, displayName: "Sam", createdAt: 1 };
  assert.equal(errorCode(await ask(member.socket, "chat:message", spoof)), "INVALID_PAYLOAD");

  const received = once<{ message: ChatMessage }>(owner.socket, "chat:message").then((update) => update.message);
  await ask(member.socket, "chat:message", { text: "hi" });
  const message = await received;
  assert.equal(message.type, "user");
  assert.ok(message.type === "user" && message.userId === member.userId && message.displayName === "Mia");
});

test("a client cannot create a system message", async () => {
  const { duck } = await start();
  const { socket, state } = await duck();
  const fake = { type: "system", event: "joined", text: "🦆 Admin joined the room" };
  assert.equal(errorCode(await ask(socket, "chat:message", fake)), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(socket, "chat:message", { text: "hello", type: "system" })), "INVALID_PAYLOAD");
  // The only system message is the server's own note that this duck joined.
  assert.deepEqual(state.messages.filter((message) => message.type === "system").map((message) => message.text), ["🦆 Sam waddled in."]);
});

test("a chat flood is rate limited and rejected messages are not broadcast", async () => {
  const { duck, logs } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");
  let delivered = 0;
  let errors = 0;
  owner.socket.on("chat:message", ({ message }: { message: ChatMessage }) => message.type === "user" && delivered++);
  member.socket.on("socket:error", () => errors++);

  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => ask(member.socket, "chat:message", { text: `spam ${i}` })));
  await wait(100);
  assert.equal(results.filter((result) => result.ok).length, 5);
  assert.equal(results.filter((result) => errorCode(result) === "RATE_LIMITED").length, 7);
  assert.equal(delivered, 5);
  assert.equal(errors, 0); // each refusal came back in its acknowledgement, so no separate error was sent
  assert.ok(logs.includes("CHAT_RATE_LIMITED"));
});

test("only the last 100 messages are kept", async () => {
  const quick = { limit: 1000, windowMs: 1000 };
  const { duck } = await start({}, { chat: quick, chatSlow: quick, socketEvents: quick });
  const owner = await duck();
  for (let i = 0; i < 110; i++) await ask(owner.socket, "chat:message", { text: `message ${i}` });

  const member = await duck(owner.code, "Mia");
  assert.equal(member.state.messages.length, 100);
  // The newest of them is the note that Mia herself joined; before it, the last 99 chat messages.
  assert.equal(member.state.messages.at(-1)?.text, "🦆 Mia waddled in.");
  assert.equal(member.state.messages[0].text, "message 11");
  assert.equal(member.state.messages.at(-2)?.text, "message 109");
});

test("chat text is cleaned: control characters removed, emoji kept", () => {
  assert.equal(ChatTextSchema.parse("  hi\u0000\u0007 there\r\n‮evil 👨‍👩‍👧 🦆 "), "hi there evil 👨‍👩‍👧 🦆");
  assert.equal(ChatTextSchema.safeParse("\u0000\u0001").success, false);
  assert.equal(ChatTextSchema.safeParse("🦆".repeat(300)).success, true);
  assert.equal(ChatTextSchema.safeParse("🦆".repeat(301)).success, false);
  assert.equal(DisplayNameSchema.safeParse("Sam\n").data, "Sam");
});

// --- Music -------------------------------------------------------------------

test("only the owner controls music, and every change raises the version", async () => {
  const { duck, logs } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");

  for (const event of ["music:play", "music:pause", "music:next"]) {
    assert.equal(errorCode(await ask(member.socket, event)), "FORBIDDEN", event);
  }
  assert.equal(errorCode(await ask(member.socket, "music:station", { stationId: "jazz" })), "FORBIDDEN");
  assert.ok(logs.includes("MUSIC_PERMISSION_DENIED"));

  const first = once<{ state: MusicState }>(member.socket, "music:state").then((update) => update.state);
  assert.equal(errorCode(await ask(owner.socket, "music:play")), "OK");
  const played = await first;
  assert.equal(played.playing, true);
  assert.equal(played.version, owner.state.music.version + 1);

  const second = once<{ state: MusicState }>(member.socket, "music:state").then((update) => update.state);
  assert.equal(errorCode(await ask(owner.socket, "music:station", { stationId: "jazz" })), "OK");
  const switched = await second;
  assert.equal(switched.stationId, "jazz");
  assert.equal(switched.version, played.version + 1);
});

test("only the owner can change the room's scene, and only to a known one", async () => {
  const { duck } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");
  assert.equal(member.state.scene, "valley");

  assert.equal(errorCode(await ask(member.socket, "room:scene", { scene: "festival" })), "FORBIDDEN");
  assert.equal(errorCode(await ask(owner.socket, "room:scene", { scene: "volcano" })), "INVALID_PAYLOAD");

  const changed = once<{ settings: { scene: string } }>(member.socket, "room:settingsChanged").then((update) => update.settings);
  assert.equal(errorCode(await ask(owner.socket, "room:scene", { scene: "festival" })), "OK");
  assert.equal((await changed).scene, "festival");

  const late = await duck(owner.code, "Leo");
  assert.equal(late.state.scene, "festival");
});

test("the owner cannot switch to an unknown station or a URL", async () => {
  const { duck } = await start();
  const { socket } = await duck();
  assert.equal(errorCode(await ask(socket, "music:station", { stationId: "https://evil.example/a.mp3" })), "INVALID_STATE"); // well formed, but not a station the server knows
  assert.equal(errorCode(await ask(socket, "music:station", { stationId: "jazz", url: "https://evil.example/a.mp3" })), "INVALID_PAYLOAD");
});

test("only the owner can upload a song, and it must really be audio", async () => {
  const { duck, url } = await start();
  const owner = await duck();
  const member = await duck(owner.code, "Mia");
  const wav = Buffer.alloc(64);
  wav.write("RIFF", 0);
  wav.write("WAVEfmt ", 8);
  const upload = (cookie: string, body: Buffer, type = "audio/wav") =>
    fetch(`${url}/upload?room=${owner.code}&name=My%20song`, { method: "POST", headers: { cookie, "x-duck-room": "1", "content-type": type }, body: new Uint8Array(body) });

  assert.equal((await upload(member.cookie, wav)).status, 403);
  assert.equal((await upload(owner.cookie, Buffer.from("<script>alert(1)</script> not audio at all"))).status, 400);
  assert.equal((await upload(owner.cookie, wav, "text/html")).status, 400);

  const state = once<{ state: MusicState }>(member.socket, "music:state").then((update) => update.state);
  assert.equal((await upload(owner.cookie, wav)).status, 201);
  const { tracks, stationId } = await state;
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].name, "My song");
  assert.equal(stationId, tracks[0].id);
  assert.match(tracks[0].url, /^\/uploads\/[0-9a-f-]{36}\.wav$/);

  assert.equal(errorCode(await ask(member.socket, "music:removeTrack", { trackId: tracks[0].id })), "FORBIDDEN");
  assert.equal(errorCode(await ask(owner.socket, "music:removeTrack", { trackId: tracks[0].id })), "OK");
  assert.equal((await fetch(url + tracks[0].url)).status, 404);
});

// --- Transport ---------------------------------------------------------------

test("an unknown event or a broken payload is handled safely", async () => {
  const { duck, logs } = await start();
  const { socket } = await duck();
  const error = once<{ error: { code: string } }>(socket, "socket:error").then((sent) => sent.error);
  socket.emit("admin:deleteEverything", { force: true });
  assert.equal((await error).code, "INVALID_PAYLOAD");
  assert.ok(logs.includes("INVALID_SOCKET_EVENT"));

  assert.equal(errorCode(await ask(socket, "chat:message", "just a string")), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(socket, "chat:message", { text: { $gt: "" } })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(socket, "music:play", { extra: 1 })), "INVALID_PAYLOAD");
  // The server is still fine afterwards.
  assert.equal(errorCode(await ask(socket, "chat:message", { text: "still here" })), "OK");
});

test("events before joining a room are refused", async () => {
  const { visitor, connect } = await start();
  const socket = await connect((await visitor()).cookie);
  assert.equal(errorCode(await ask(socket, "chat:message", { text: "hi" })), "NOT_IN_ROOM");
  assert.equal(errorCode(await ask(socket, "duck:move", { destination: { x: 0.5, y: 0.5 } })), "NOT_IN_ROOM");
  assert.equal(errorCode(await ask(socket, "music:play")), "NOT_IN_ROOM");
});

test("an oversized payload closes the connection", async () => {
  const { duck } = await start();
  const { socket } = await duck();
  const closed = once<string>(socket, "disconnect");
  socket.emit("chat:message", { text: "x".repeat(100_000) });
  assert.ok(await closed);
});

test("a WebSocket from another website is refused", async () => {
  const { visitor, connect } = await start();
  const { cookie } = await visitor();
  await assert.rejects(connect(cookie, { origin: "https://evil.example" }));
  await connect(cookie, { origin: "http://localhost:3000" });
});

test("security headers are set, and no CORS access is granted", async () => {
  const { url } = await start();
  const res = await fetch(`${url}/api/session`, { headers: { origin: "https://evil.example" } });
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.ok(res.headers.get("permissions-policy"));
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("production refuses to start without APP_ORIGIN and SESSION_SECRET", async () => {
  const { loadConfig } = await import("../server/config");
  assert.throws(() => loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv), /APP_ORIGIN/);
  assert.throws(() => loadConfig({ NODE_ENV: "production", APP_ORIGIN: "https://duck.example" } as NodeJS.ProcessEnv), /SESSION_SECRET/);
});
