import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { MemoryAdminStore } from "../server/adminStore";
import { createApp } from "../server/app";
import { loadConfig, type Config } from "../server/config";
import { MemoryEventRepository } from "../server/events";
import type { LogEvent } from "../server/logger";
import type { SeasonalEvent } from "../shared/events";
import type { ChatMessage, RoomState } from "../shared/protocol";

type Result = { ok: true; commandId?: string; data?: Record<string, string> } | { ok: false; commandId?: string; error: { code: string; message: string; retryAfterMs?: number } };

const generous = { limit: 10_000, windowMs: 60_000 };

/** Starts a real server (HTTP + Socket.IO, without the Next.js pages) on a free port. */
type Extras = {
  /** The event calendar for this test. Empty by default, so tests never depend on today's date. */
  events?: SeasonalEvent[];
  /** An admin account for this test. Without one, the admin page is off. */
  admin?: { username: string; password: string };
};

export async function startServer(overrides: Partial<Config> = {}, limits: Partial<Config["limits"]> = {}, extras: Extras = {}) {
  const base = loadConfig({ NODE_ENV: "test", SESSION_SECRET: "test-secret-".repeat(4) } as NodeJS.ProcessEnv);
  const config: Config = {
    ...base,
    // By default a dropped connection leaves the room at once. Tests about the grace period set it themselves.
    presenceGraceMs: 0,
    // Ducks count as arrived at once, so tests do not wait for every walk. Tests about walking turn it on.
    requireArrival: false,
    ...overrides,
    // Connection and join limits are raised so tests can open many sockets from one address.
    // Chat, movement and music keep their real limits unless a test changes them.
    limits: { ...base.limits, connect: generous, join: generous, joinPerIp: generous, createRoom: generous, createRoomPerIp: generous, ...limits },
  };
  const logs: LogEvent[] = [];
  /** The same log lines with their fields, for tests about what is and is not logged. */
  const entries: ({ event: LogEvent } & Record<string, string | undefined>)[] = [];
  // A clock the test can move, to make events start and end.
  const clock = { now: Date.now() };
  const adminStore = new MemoryAdminStore();
  if (extras.admin) adminStore.setPassword(extras.admin.username, extras.admin.password);
  const app = createApp(config, {
    adminStore,
    log: (event, fields = {}) => {
      logs.push(event);
      entries.push({ event, ...fields });
    },
    eventRepository: new MemoryEventRepository(extras.events ?? []),
    now: () => clock.now,
  });
  // Listen on the same address the tests call. Listening on every address (the default) lets the
  // system hand out a port that something else already uses on 127.0.0.1, and then a request
  // now and then goes to that other program and is never answered.
  await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.httpServer.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];

  /** A new anonymous visitor: asks the server for a session cookie. */
  const visitor = async () => {
    const res = await fetch(`${url}/api/session`, { signal: AbortSignal.timeout(10_000) });
    const setCookie = res.headers.getSetCookie()[0];
    const { userId } = (await res.json()) as { userId: string };
    return { userId, cookie: setCookie.split(";")[0], setCookie };
  };

  const connect = (cookie: string | undefined, headers: Record<string, string> = {}) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = io(url, {
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
        extraHeaders: { ...(cookie ? { cookie } : {}), ...headers },
      });
      sockets.push(socket);
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });

  const createRoom = async (cookie: string) => {
    const res = await fetch(`${url}/api/rooms`, { method: "POST", headers: { cookie, "x-duck-room": "1" }, signal: AbortSignal.timeout(10_000) });
    return ((await res.json()) as { code: string }).code;
  };

  /** A visitor who is connected and inside `code` (or inside a new room of their own). */
  const duck = async (code?: string, displayName = "Sam") => {
    const who = await visitor();
    const roomCode = code ?? (await createRoom(who.cookie));
    const socket = await connect(who.cookie);
    const state = once<RoomState>(socket, "room:snapshot");
    const history = once<{ messages: ChatMessage[] }>(socket, "chat:history");
    const joined = await ask(socket, "room:join", { roomCode, displayName, duckColor: "yellow" });
    if (!joined.ok) {
      // Nothing more will arrive on this socket; stop waiting for it.
      state.catch(() => {});
      history.catch(() => {});
      throw new Error(`join failed: ${joined.error.code}`);
    }
    // The chat arrives right after the snapshot; tests read both as one picture of the room.
    return { ...who, socket, code: roomCode, state: { ...(await state), messages: (await history).messages } };
  };

  const stop = async () => {
    for (const socket of sockets) socket.disconnect();
    await app.close();
  };

  return { url, config, logs, entries, clock, events: app.events, visitor, connect, createRoom, duck, stop };
}

/** The id each kind of command must carry. Tests that are not about ids let `ask` fill it in. */
const ID_FIELD: Record<string, string> = {
  "room:create": "commandId",
  "room:leave": "commandId",
  "music:play": "commandId",
  "music:pause": "commandId",
  "music:next": "commandId",
  "music:station": "commandId",
  "music:permission:setMode": "commandId",
  "music:permission:addDJ": "commandId",
  "music:permission:removeDJ": "commandId",
  "krathong:pickup": "commandId",
  "krathong:release": "commandId",
  "duck:move": "clientMoveId",
  "chat:message": "clientMessageId",
};

/** Adds a fresh id to a command that has none. Anything that is not a plain object is sent as it is. */
export const withId = (event: string, args: unknown[]) => {
  const field = ID_FIELD[event];
  if (!field || args.length > 1) return args;
  const [payload] = args;
  if (payload === undefined) return [{ [field]: randomUUID() }];
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) || field in payload) return args;
  return [{ [field]: randomUUID(), ...payload }];
};

/** Sends an event and waits for the server's acknowledgement. */
export const ask = (socket: Socket, event: string, ...args: unknown[]): Promise<Result> =>
  socket.timeout(2000).emitWithAck(event, ...withId(event, args));

/** Waits for the next `event`. With `trigger`, starts listening first and then runs it. */
export const once = <T>(socket: Socket, event: string, trigger?: () => unknown) =>
  new Promise<T>((resolve, reject) => {
    // A test that waits for something that never comes should say what it waited for, not hang.
    const timer = setTimeout(() => reject(new Error(`"${event}" did not arrive within 10 seconds`)), 10_000);
    timer.unref();
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
    // The event can arrive before the trigger's own answer does. If the test ends in between,
    // that answer is cancelled, which must not count as a failure.
    Promise.resolve(trigger?.()).catch(() => {});
  });

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const errorCode = (result: Result) => (result.ok ? "OK" : result.error.code);

/** An update without its room version and server time, for comparing just the content. */
export const bare = <T extends object>(update: T) => {
  const { roomVersion: _roomVersion, serverTime: _serverTime, ...content } = update as T & { roomVersion?: number; serverTime?: number };
  return content;
};
