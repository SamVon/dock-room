// The seasonal event engine: the server decides what is active, by its own clock.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteAdminStore, adminDatabasePath, hashPassword, passwordMatches } from "../server/adminStore";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_EVENTS } from "../config/events";
import { MemoryEventRepository, EventService } from "../server/events";
import { DECORATIONS, EVENT_SCENES, PARTICLES, SeasonalEventSchema, WEATHERS, eventConfigProblems, type EventSnapshot, type SeasonalEvent } from "../shared/events";
import { WEARABLES } from "../shared/cosmetics";
import type { MusicState } from "../shared/protocol";
import { ask, errorCode, once, startServer, wait } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>> | undefined;
const start = async (...args: Parameters<typeof startServer>) => (server = await startServer(...args));
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const HOUR = 3_600_000;
const T0 = Date.parse("2030-01-10T12:00:00Z");
const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString();

const event = (slug: string, from: number, to: number, priority: number, extra: Partial<SeasonalEvent> = {}): SeasonalEvent => ({
  id: `evt-${slug}`,
  slug,
  name: slug,
  enabled: true,
  startAt: at(from),
  endAt: at(to),
  priority,
  theme: { scene: "duck-valley" },
  ...extra,
});

const service = (events: SeasonalEvent[], now = T0, forceSlug?: string) => {
  const clock = { now };
  return { clock, events: new EventService(new MemoryEventRepository(events), { log: () => {}, now: () => clock.now, forceSlug }) };
};

// --- Which event is active ------------------------------------------------------

test("an event is active only when enabled and inside its dates", () => {
  const { events } = service([event("past", -10, -1, 50), event("future", 1, 10, 50), event("off", -1, 1, 50, { enabled: false })]);
  assert.equal(events.resolve(), null);
  assert.equal(events.resolve(T0 + 2 * HOUR)?.slug, "future");
  assert.equal(events.resolve(T0 + 10 * HOUR), null); // the end time itself is already outside
  assert.equal(events.resolve(T0 - 5 * HOUR)?.slug, "past");
});

test("when events overlap, the highest priority wins", () => {
  const { events } = service([event("rainy-season", -100, 100, 10), event("new-year", -1, 1, 100)]);
  assert.equal(events.resolve()?.slug, "new-year");
  assert.equal(events.resolve(T0 + 2 * HOUR)?.slug, "rainy-season");
});

test("the version grows with every change and the change kind is reported", () => {
  const { events, clock } = service([event("a", 1, 2, 50), event("b", 2, 3, 50)]);
  const seen: string[] = [];
  events.onChange((change, snapshot) => seen.push(`${change}:${snapshot.state.slug}:${snapshot.state.version}`));
  const v0 = events.snapshot().state.version;

  events.tick(); // nothing changed
  clock.now = T0 + 1.5 * HOUR;
  events.tick();
  clock.now = T0 + 2.5 * HOUR;
  events.tick(); // a ends and b starts at the same moment
  clock.now = T0 + 5 * HOUR;
  events.tick();
  assert.deepEqual(seen, [`started:a:${v0 + 1}`, `ended:b:${v0 + 2}`, `started:b:${v0 + 2}`, `ended:null:${v0 + 3}`]);

  events.upsert(event("c", 4, 6, 50));
  events.upsert(event("c", 4, 6, 50, { name: "renamed" }));
  assert.deepEqual(seen.slice(4), [`started:c:${v0 + 4}`, `updated:c:${v0 + 5}`]);
});

test("FORCE_EVENT makes an event active whatever its dates say", () => {
  assert.equal(service([event("past", -10, -1, 50)], T0, "past").events.active()?.slug, "past");
});

// --- Configuration ---------------------------------------------------------------

test("event configs are validated: bad dates, unknown fields and unsafe text are refused", () => {
  const good = event("ok", 0, 1, 50);
  assert.equal(SeasonalEventSchema.safeParse(good).success, true);
  assert.equal(SeasonalEventSchema.safeParse({ ...good, endAt: good.startAt }).success, false);
  assert.equal(SeasonalEventSchema.safeParse({ ...good, slug: "Bad Slug!" }).success, false);
  assert.equal(SeasonalEventSchema.safeParse({ ...good, name: "x\u0000" }).success, false);
  assert.equal(SeasonalEventSchema.safeParse({ ...good, grantAdmin: true }).success, false);
  assert.equal(SeasonalEventSchema.safeParse({ ...good, theme: { scene: "https://evil.example/scene.png" } }).success, false);
  assert.equal(SeasonalEventSchema.safeParse({ ...good, ui: { accent: "red; background:url(x)" } }).success, false);
});

test("names without art are reported, not fatal", () => {
  const odd = event("odd", 0, 1, 50, { theme: { scene: "moon-base", decorations: ["lanterns", "lasers"], particles: ["snow", "plasma"], weather: "tornado" }, ducks: { accessories: ["santa-hat", "jetpack"] } });
  const problems = eventConfigProblems(odd, [], WEARABLES.map((wearable) => wearable.id));
  assert.equal(problems.length, 5);
  assert.ok(problems.every((problem) => /moon-base|lasers|plasma|tornado|jetpack/.test(problem)));
});

test("the built-in calendar is valid and uses known scenes, decorations, particles and weather", () => {
  assert.equal(new Set(DEFAULT_EVENTS.map((item) => item.slug)).size, DEFAULT_EVENTS.length);
  for (const item of DEFAULT_EVENTS) {
    assert.equal(SeasonalEventSchema.safeParse(item).success, true, item.slug);
    assert.ok(EVENT_SCENES.includes(item.theme.scene as never), item.slug);
    if (item.theme.weather) assert.ok(WEATHERS.includes(item.theme.weather as never), item.slug);
    for (const name of item.theme.particles ?? []) assert.ok(PARTICLES.includes(name as never), `${item.slug}: ${name}`);
  }
  // A few placeholders (wetTrees, raincoat, umbrella, party-hat) have no art yet: they must be skipped, not crash.
  const unknown = DEFAULT_EVENTS.flatMap((item) => (item.theme.decorations ?? []).filter((name) => !DECORATIONS.includes(name as never)));
  assert.deepEqual(unknown, ["wetTrees"]);
});

// --- Realtime ----------------------------------------------------------------------

test("clients are told when an event starts and ends, and a newcomer gets the current one", async () => {
  const festival = event("boat-festival", 1, 2, 60, { theme: { scene: "riverside-festival", decorations: ["racingBoats"], musicStation: "festival-lofi" } });
  const { duck, clock, events } = await start({}, {}, { events: [festival] });
  clock.now = T0;
  events.tick();
  const owner = await duck();
  assert.equal(owner.state.event.event, null);

  const started = once<EventSnapshot>(owner.socket, "event:started");
  const state = once<EventSnapshot>(owner.socket, "event:state");
  clock.now = T0 + 1.5 * HOUR;
  events.tick();
  assert.equal((await started).event?.slug, "boat-festival");
  const snapshot = await state;
  assert.equal(snapshot.state.slug, "boat-festival");
  assert.equal(snapshot.state.endAt, festival.endAt);
  assert.ok(snapshot.state.version > owner.state.event.state.version);

  const late = await duck(owner.code, "Mia");
  assert.equal(late.state.event.event?.theme.scene, "riverside-festival");

  const ended = once<EventSnapshot>(late.socket, "event:ended");
  clock.now = T0 + 3 * HOUR;
  events.tick();
  assert.equal((await ended).event, null);
});

test("an event's station is playable while it runs, and rooms fall back when it ends", async () => {
  const winter = event("christmas", -1, 1, 50, { theme: { scene: "snowy-duck-village", musicStation: "winter-lofi" } });
  const { duck, clock, events } = await start({}, {}, { events: [winter] });
  clock.now = T0;
  events.tick();
  const owner = await duck();
  assert.equal(owner.state.music.stationId, "winter-lofi"); // a room opened during the event starts on its station
  assert.equal(errorCode(await ask(owner.socket, "music:station", { stationId: "jazz" })), "OK");
  assert.equal(errorCode(await ask(owner.socket, "music:station", { stationId: "winter-lofi" })), "OK");

  const fallback = once<{ state: MusicState }>(owner.socket, "music:state").then((update) => update.state);
  clock.now = T0 + 2 * HOUR;
  events.tick();
  assert.equal((await fallback).stationId, "lofi");
  assert.equal(errorCode(await ask(owner.socket, "music:station", { stationId: "winter-lofi" })), "INVALID_STATE");
});

test("room members cannot start, change or fake an event", async () => {
  const { duck } = await start();
  const { socket } = await duck();
  for (const name of ["event:state", "event:started", "event:updated", "event:ended"]) {
    const error = once<{ error: { code: string } }>(socket, "socket:error").then((sent) => sent.error);
    socket.emit(name, { state: { eventId: "evt-x", slug: "new-year", version: 999 }, event: { slug: "new-year" } });
    assert.equal((await error).code, "INVALID_PAYLOAD", name);
  }
  assert.equal(errorCode(await ask(socket, "room:scene", { scene: "valley", eventId: "evt-x" })), "INVALID_PAYLOAD");
  assert.equal(errorCode(await ask(socket, "chat:message", { text: "hi", eventReward: "gold-crown", eventScore: 9999 })), "INVALID_PAYLOAD");
});

// --- Preview and admin ---------------------------------------------------------------

test("event preview is for development or admins only", async () => {
  const halloween = event("halloween", 100, 200, 50);
  const dev = await start({}, {}, { events: [halloween] });
  assert.equal((await fetch(`${dev.url}/api/events/preview?slug=halloween`)).status, 200);
  assert.equal((await fetch(`${dev.url}/api/events/preview?slug=nope`)).status, 404);
  await dev.stop();

  const live = await start({ production: true }, {}, { events: [halloween], admin: ADMIN });
  assert.equal((await fetch(`${live.url}/api/events/preview?slug=halloween`)).status, 403);
  // Previewing never changes what is active for everyone.
  assert.equal(live.events.active(), null);
});

const ADMIN = { username: "sam", password: "correct-horse-battery" };

test("the admin API needs an admin account's name and password, and is off when there is no account", async () => {
  const off = await start();
  assert.equal((await fetch(`${off.url}/api/admin/events`)).status, 404);
  await off.stop();

  const { url, events } = await start({}, {}, { admin: ADMIN });
  const headers = { "x-duck-room": "1", "content-type": "application/json" };
  const login = (password: string, username = ADMIN.username) => fetch(`${url}/api/admin/login`, { method: "POST", headers, body: JSON.stringify({ username, password }) });

  assert.equal((await fetch(`${url}/api/admin/events`)).status, 401);
  assert.equal((await fetch(`${url}/api/admin/events`, { method: "PUT", headers, body: JSON.stringify(event("x", -1, 1, 50)) })).status, 401);
  assert.equal((await login("wrong")).status, 401);
  assert.equal((await login(ADMIN.password, "nobody")).status, 401);
  // The old way, one shared token, no longer signs anyone in.
  assert.equal((await fetch(`${url}/api/admin/login`, { method: "POST", headers, body: JSON.stringify({ token: ADMIN.password }) })).status, 401);

  const ok = await login(ADMIN.password, " SAM "); // the name is not case sensitive
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/);
  assert.doesNotMatch(setCookie, /correct-horse-battery/);
  const cookie = setCookie.split(";")[0];

  const admin = { ...headers, cookie };
  assert.equal((await fetch(`${url}/api/admin/events`, { headers: { cookie } })).status, 200);
  // A change also needs the custom header, so another website cannot trigger it.
  assert.equal((await fetch(`${url}/api/admin/events`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(event("x", -1, 1, 50)) })).status, 401);
  assert.equal((await fetch(`${url}/api/admin/events`, { method: "PUT", headers: admin, body: JSON.stringify({ slug: "broken" }) })).status, 400);

  const live = event("party", -1, 1, 50, { startAt: new Date(Date.now() - HOUR).toISOString(), endAt: new Date(Date.now() + HOUR).toISOString() });
  assert.equal((await fetch(`${url}/api/admin/events`, { method: "PUT", headers: admin, body: JSON.stringify(live) })).status, 200);
  assert.equal(events.active()?.slug, "party");
  assert.equal((await fetch(`${url}/api/admin/events?slug=party`, { method: "DELETE", headers: admin })).status, 200);
  assert.equal(events.active(), null);

  // A forged admin cookie does not work.
  assert.equal((await fetch(`${url}/api/admin/events`, { headers: { cookie: `duck_admin=${Date.now() + HOUR}.forged` } })).status, 401);
});

test("admin sign-in attempts are rate limited", async () => {
  const { url, logs } = await start({}, {}, { admin: ADMIN });
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    statuses.push((await fetch(`${url}/api/admin/login`, { method: "POST", headers: { "x-duck-room": "1" }, body: JSON.stringify({ username: "sam", password: `guess-${i}` }) })).status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429, 429]);
  assert.ok(logs.includes("ADMIN_LOGIN"));
  await wait(1);
});

test("admin passwords are stored only as salted hashes, in a database file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "duck-admin-"));
  const file = adminDatabasePath(dir);
  try {
    const store = new SqliteAdminStore(file);
    assert.equal(store.count(), 0);
    assert.throws(() => store.setPassword("sam", "short"), /at least/);
    assert.throws(() => store.setPassword("s", ADMIN.password), /name/);
    assert.throws(() => store.setPassword("sam'; DROP TABLE admins;--", ADMIN.password), /name/);

    store.setPassword("Sam", ADMIN.password);
    store.setPassword("bow", ADMIN.password);
    assert.deepEqual(store.list().map((account) => account.username), ["bow", "sam"]);
    assert.ok(store.verify("sam", ADMIN.password));
    assert.ok(!store.verify("sam", "correct-horse-batterx"));
    assert.ok(!store.verify("nobody", ADMIN.password));
    assert.ok(!store.verify("' OR '1'='1", ADMIN.password));

    // Changing the password replaces the old one.
    store.setPassword("sam", "a-brand-new-password");
    assert.ok(!store.verify("sam", ADMIN.password));
    assert.ok(store.verify("sam", "a-brand-new-password"));
    assert.equal(store.count(), 2);
    store.close();

    // The file holds no password, the two equal passwords were hashed differently, and only the owner can read it.
    const raw = readFileSync(file).toString("latin1");
    assert.ok(!raw.includes(ADMIN.password) && !raw.includes("a-brand-new-password"));
    assert.notEqual(hashPassword(ADMIN.password), hashPassword(ADMIN.password));
    assert.ok(passwordMatches(ADMIN.password, hashPassword(ADMIN.password)));
    assert.equal(statSync(file).mode & 0o777, 0o600);

    // It is still there after a restart.
    const again = new SqliteAdminStore(file);
    assert.ok(again.verify("bow", ADMIN.password));
    assert.ok(again.remove("bow"));
    assert.equal(again.count(), 1);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
