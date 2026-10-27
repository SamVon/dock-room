// Plain HTTP endpoints handled before Next.js: session, room creation, song upload.
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { WEARABLES } from "../shared/cosmetics";
import { DECORATIONS, EVENT_SCENES, MINIGAMES, PARTICLES, WEATHERS, eventConfigProblems } from "../shared/events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { RoomCodeSchema, TrackNameSchema, type SocketErrorCode } from "../shared/protocol";
import { adminCookie, clearAdminCookie, isAdmin } from "./admin";
import type { AdminStore } from "./adminStore";
import type { Config } from "./config";
import type { CosmeticService } from "./cosmetics";
import type { EventService } from "./events";
import type { Logger } from "./logger";
import type { Limiters, Realtime } from "./realtime";
import type { RoomService } from "./rooms";
import { createSession, readSession, sessionCookie } from "./sessions";
import { MAX_TRACKS, MAX_UPLOAD_BYTES, audioExtension, looksLikeAudio, saveUpload, serveUpload } from "./uploads";

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Only our own site may call us. Requests without an Origin header are not from a browser page. */
export const originCheck = (config: Config) => (origin: string | undefined) =>
  !origin || origin === config.appOrigin || (!config.production && LOCAL_ORIGIN.test(origin));

/** The visitor's address. Proxy headers are only believed when TRUST_PROXY is on. */
export const ipReader = (config: Config) => (req: IncomingMessage) => {
  const forwarded = config.trustProxy && (req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"]);
  return String(forwarded || req.socket.remoteAddress || "unknown").split(",")[0].trim();
};

export function securityHeaders(config: Config): Record<string, string> {
  const streams = config.stations.flatMap((station) => (station.url ? [new URL(station.url).origin] : []));
  const csp = [
    "default-src 'self'",
    // Next.js needs inline scripts; its dev mode also needs eval.
    `script-src 'self' 'unsafe-inline'${config.production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `media-src 'self' ${streams.join(" ")}`.trim(),
    `connect-src 'self'${config.production ? "" : " ws: wss:"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    // The room code is in the URL, so never send the URL to other sites.
    "Referrer-Policy": "no-referrer",
    // The microphone is for the voice chat, and only for our own pages.
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=()",
    ...(config.production && config.appOrigin?.startsWith("https://")
      ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
      : {}),
  };
}

type Deps = {
  config: Config;
  rooms: RoomService;
  cosmetics: CosmeticService;
  events: EventService;
  log: Logger;
  limiters: Limiters;
  /** Admin accounts. With none, the admin page is switched off. */
  admins: AdminStore;
  realtime: () => Realtime;
  /** Everything that is not one of our endpoints (the Next.js pages). */
  fallback: (req: IncomingMessage, res: ServerResponse) => void;
};

export function createHttpHandler({ config, rooms, cosmetics, events, log, limiters, admins, realtime, fallback }: Deps) {
  const headers = Object.entries(securityHeaders(config));
  const isAllowedOrigin = originCheck(config);
  const clientIp = ipReader(config);

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, code: SocketErrorCode, message: string) =>
    json(res, status, { ok: false, error: { code, message } });

  /** Changes need a valid session, our own origin, and a custom header that other sites cannot send. */
  const authorize = (req: IncomingMessage, res: ServerResponse) => {
    const session = readSession(req.headers.cookie, config.sessionSecret);
    if (!session || !isAllowedOrigin(req.headers.origin) || req.headers["x-duck-room"] !== "1") {
      log(session ? "ORIGIN_REJECTED" : "SESSION_INVALID", { userId: session?.userId, result: "rejected" });
      fail(res, 401, "UNAUTHENTICATED", "Please reload the page");
      return null;
    }
    return session;
  };

  const getSession = (req: IncomingMessage, res: ServerResponse) => {
    let session = readSession(req.headers.cookie, config.sessionSecret);
    if (!session) {
      session = createSession();
      res.setHeader("Set-Cookie", sessionCookie(session, config.sessionSecret, config.production));
    }
    // Only the public id is returned. The signed cookie itself is never readable by page scripts.
    json(res, 200, {
      ok: true,
      userId: session.userId,
      scene: config.defaultScene,
      event: events.snapshot(),
      // For the dressing screen before joining a room: what this session may wear, and wore last.
      inventory: cosmetics.inventory(session.userId),
      equipment: cosmetics.equipmentOf(session.userId),
    });
  };

  /** "user:commandId" -> the room that command created, so a retried request does not open a second room. */
  const createdBy = new Map<string, { code: string; at: number }>();

  const createRoom = (req: IncomingMessage, res: ServerResponse) => {
    const session = authorize(req, res);
    if (!session) return;
    const commandId = String(req.headers["x-command-id"] ?? "");
    const memoryKey = /^[0-9a-f-]{36}$/.test(commandId) ? `${session.userId}:${commandId}` : undefined;
    const before = memoryKey && createdBy.get(memoryKey);
    if (before && rooms.find(before.code)) return json(res, 201, { ok: true, code: before.code });
    if (!limiters.createRoom.allow(session.userId) || !limiters.createRoomPerIp.allow(clientIp(req))) {
      log("RATE_LIMITED", { userId: session.userId, detail: "create room" });
      return fail(res, 429, "RATE_LIMITED", "Too many rooms. Wait a moment.");
    }
    const room = rooms.create(session.userId);
    if (!room) return fail(res, 503, "INTERNAL_ERROR", "The server is busy. Try again later.");
    cosmetics.rewardHost(session.userId);
    // A room opened during an event starts on that event's station.
    room.music.stationId = events.active()?.theme.musicStation ?? room.music.stationId;
    if (memoryKey) {
      createdBy.set(memoryKey, { code: room.code, at: Date.now() });
      for (const [key, made] of createdBy) if (Date.now() - made.at > 60_000) createdBy.delete(key);
    }
    json(res, 201, { ok: true, code: room.code });
  };

  const upload = async (req: IncomingMessage, res: ServerResponse, params: URLSearchParams) => {
    const session = authorize(req, res);
    if (!session) return;
    const code = RoomCodeSchema.safeParse(params.get("room") ?? "");
    const room = code.success ? rooms.find(code.data) : undefined;
    // Ownership comes from the server's record of the room, matched against the signed session.
    if (!room || room.ownerUserId !== session.userId || !room.users.has(session.userId)) {
      log("PERMISSION_DENIED", { roomId: room?.id, userId: session.userId, result: "FORBIDDEN", detail: "upload" });
      return fail(res, 403, "FORBIDDEN", "Only the room owner can add music");
    }
    if (!limiters.upload.allow(session.userId)) return fail(res, 429, "RATE_LIMITED", "Too many uploads. Wait a moment.");

    const name = TrackNameSchema.safeParse(params.get("name") ?? "");
    const extension = audioExtension(req.headers["content-type"]);
    if (!name.success || !extension) return fail(res, 400, "INVALID_PAYLOAD", "Use an MP3, OGG, WAV or M4A file");
    if (room.music.tracks.length >= MAX_TRACKS) return fail(res, 400, "INVALID_PAYLOAD", `A room can have ${MAX_TRACKS} songs`);
    if (Number(req.headers["content-length"]) > MAX_UPLOAD_BYTES) return fail(res, 413, "INVALID_PAYLOAD", "File is too big (max 20 MB)");

    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) return fail(res, 413, "INVALID_PAYLOAD", "File is too big (max 20 MB)");
        chunks.push(chunk);
      }
      const file = Buffer.concat(chunks);
      if (file.length < 16 || !looksLikeAudio(file)) return fail(res, 400, "INVALID_PAYLOAD", "That file is not audio");

      const url = await saveUpload(extension, file);
      room.uploads.add(url);
      realtime().addTrack(room, { id: randomUUID(), name: name.data, url });
      log("TRACK_UPLOADED", { roomId: room.id, userId: session.userId, result: "ok" });
      json(res, 201, { ok: true });
    } catch (error) {
      log("SERVER_ERROR", { roomId: room.id, userId: session.userId, detail: `upload: ${error instanceof Error ? error.message : "unknown"}` });
      fail(res, 500, "INTERNAL_ERROR", "Upload failed");
    }
  };

  // --- Events: preview and admin -------------------------------------------------

  const WEARABLE_IDS = WEARABLES.map((wearable) => wearable.id);
  const admin = (req: IncomingMessage) => isAdmin(req.headers.cookie, config.sessionSecret);

  /** Reads a small JSON body. Anything too big or malformed is treated as empty. */
  const readJson = async (req: IncomingMessage, maxBytes: number): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) return undefined;
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return undefined;
    }
  };

  /** Looking at an event that is not active is for developers and admins only; it changes nothing for anyone else. */
  const previewEvent = (req: IncomingMessage, res: ServerResponse, params: URLSearchParams) => {
    if (config.production && !admin(req)) return fail(res, 403, "FORBIDDEN", "Event preview is not available");
    const event = events.list().find((item) => item.slug === params.get("slug"));
    if (!event) return fail(res, 404, "INVALID_PAYLOAD", "No such event");
    json(res, 200, { ok: true, event });
  };

  /** Admin requests need the admin cookie; changes also need our own origin and the custom header. */
  const requireAdmin = (req: IncomingMessage, res: ServerResponse, changing: boolean) => {
    if (admins.count() === 0) return fail(res, 404, "FORBIDDEN", "Admin is switched off"), false;
    if (!admin(req) || (changing && (!isAllowedOrigin(req.headers.origin) || req.headers["x-duck-room"] !== "1"))) {
      return fail(res, 401, "UNAUTHENTICATED", "Sign in as admin first"), false;
    }
    return true;
  };

  const adminLogin = async (req: IncomingMessage, res: ServerResponse) => {
    if (admins.count() === 0) return fail(res, 404, "FORBIDDEN", "Admin is switched off");
    if (!isAllowedOrigin(req.headers.origin) || req.headers["x-duck-room"] !== "1") return fail(res, 401, "UNAUTHENTICATED", "Please reload the page");
    if (!limiters.adminLogin.allow(clientIp(req))) {
      log("ADMIN_LOGIN", { result: "rate limited" });
      return fail(res, 429, "RATE_LIMITED", "Too many attempts. Wait a minute.");
    }
    const body = (await readJson(req, 2048)) as { username?: unknown; password?: unknown } | undefined;
    // One answer for a wrong name and a wrong password, so names cannot be guessed. Neither is logged.
    if (typeof body?.username !== "string" || typeof body.password !== "string" || !admins.verify(body.username, body.password)) {
      log("ADMIN_LOGIN", { result: "denied" });
      return fail(res, 401, "UNAUTHENTICATED", "That name and password do not match");
    }
    log("ADMIN_LOGIN", { result: "ok" });
    res.setHeader("Set-Cookie", adminCookie(config.sessionSecret, config.production));
    json(res, 200, { ok: true });
  };

  const adminList = (req: IncomingMessage, res: ServerResponse) => {
    if (!requireAdmin(req, res, false)) return;
    const now = Date.now();
    json(res, 200, {
      ok: true,
      active: events.snapshot().state,
      events: events.list().map((event) => ({
        event,
        problems: eventConfigProblems(event, [], WEARABLE_IDS),
        status: !event.enabled ? "disabled" : now < Date.parse(event.startAt) ? "scheduled" : now >= Date.parse(event.endAt) ? "ended" : "in dates",
      })),
      // What the form may offer: only names that have art or meaning.
      options: { scenes: EVENT_SCENES, decorations: DECORATIONS, particles: PARTICLES, weathers: WEATHERS, minigames: MINIGAMES, accessories: WEARABLE_IDS },
    });
  };

  const adminSave = async (req: IncomingMessage, res: ServerResponse) => {
    if (!requireAdmin(req, res, true)) return;
    try {
      const event = events.upsert(await readJson(req, 32_768));
      log("ADMIN_CHANGE", { result: "saved", detail: event.slug });
      json(res, 200, { ok: true, event });
    } catch (error) {
      const issue = error instanceof ZodError ? error.issues[0] : undefined;
      fail(res, 400, "INVALID_PAYLOAD", issue ? `${issue.path.join(".") || "event"}: ${issue.message}` : "That event is not valid");
    }
  };

  const adminDelete = (req: IncomingMessage, res: ServerResponse, params: URLSearchParams) => {
    if (!requireAdmin(req, res, true)) return;
    const slug = params.get("slug") ?? "";
    events.remove(slug);
    log("ADMIN_CHANGE", { result: "deleted", detail: slug.slice(0, 40) });
    json(res, 200, { ok: true });
  };

  return (req: IncomingMessage, res: ServerResponse) => {
    for (const [name, value] of headers) res.setHeader(name, value);
    const { pathname, searchParams } = new URL(req.url ?? "/", "http://localhost");

    if (pathname === "/api/session" && req.method === "GET") return getSession(req, res);
    if (pathname === "/api/rooms" && req.method === "POST") return createRoom(req, res);
    if (pathname === "/upload" && req.method === "POST") return void upload(req, res, searchParams);
    if (pathname.startsWith("/uploads/") && req.method === "GET") return serveUpload(req, res, pathname);
    if (pathname === "/api/events/preview" && req.method === "GET") return previewEvent(req, res, searchParams);
    if (pathname === "/api/admin/login" && req.method === "POST") return void adminLogin(req, res);
    if (pathname === "/api/admin/logout" && req.method === "POST") {
      res.setHeader("Set-Cookie", clearAdminCookie());
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/admin/events" && req.method === "GET") return adminList(req, res);
    if (pathname === "/api/admin/events" && req.method === "PUT") return void adminSave(req, res);
    if (pathname === "/api/admin/events" && req.method === "DELETE") return adminDelete(req, res, searchParams);
    fallback(req, res);
  };
}
