// All Socket.IO traffic. Every command goes through the same steps, in this order:
//   session (checked on connect) -> payload validation -> room membership -> authorization -> rate limit
//   -> repeated command? -> state checks -> change -> version + 1 -> acknowledge -> broadcast
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { z, ZodType } from "zod";
import { EquipSchema, UnequipSchema } from "../shared/cosmetics";
import { stationName } from "../shared/events";
import { INTERACTION_ZONES, PLACE_MS, PickupSchema, RELEASE_MS, ReleaseSchema, inZone, isKrathongVariant, type FloatingKrathong, type InteractionZoneType } from "../shared/interactions";
import { VoiceMuteSchema, VoiceSignalSchema } from "../shared/voice";
import { MAX_INTERACTION_MOVE_DISTANCE, MEETING_GAP, STICKERS, StickerSchema, stickerAvailable } from "../shared/stickers";
import {
  CLIENT_EVENTS,
  CommandSchema,
  DJSchema,
  ItemSchema,
  JoinSchema,
  MessageSchema,
  MoveSchema,
  MusicModeSchema,
  NoPayloadSchema,
  RemoveTrackSchema,
  ResumeSchema,
  ResyncSchema,
  RoomCreateSchema,
  SceneSchema,
  StationSchema,
  type ChatMessage,
  type ClientToServerEvents,
  type DeltaEvent,
  type DuckStateChangedPayload,
  type HeldItemId,
  type DuckColorId,
  type MusicState,
  type RoomState,
  type RoomUser,
  type ServerToClientEvents,
  type SocketAck,
  type SocketError,
  type Station,
  type StickerMatchPayload,
  type Track,
  type UserLeftReason,
  type VersionFields,
} from "../shared/protocol";
import { AppError, requireMusicControl, requireRoomMember, requireRoomOwner, type AppSocket, type SocketData } from "./auth";
import type { Config } from "./config";
import type { CosmeticService } from "./cosmetics";
import type { EventService } from "./events";
import type { Logger } from "./logger";
import type { RateLimiter } from "./rateLimit";
import type { Member, Room, RoomService } from "./rooms";
import { readSession } from "./sessions";
import { walkDurationMs } from "../shared/sync";
import { deleteUpload } from "./uploads";

export type Limiters = Record<keyof Config["limits"], RateLimiter>;
type RoomContext = { room: Room; member: Member };
type EventName = keyof ClientToServerEvents;

/**
 * A browser starts its duck walking before the server hears of the move, so it sees the duck
 * arrive a little earlier than the server does. This much early is still "arrived".
 */
const ARRIVAL_SLACK_MS = 250;

/**
 * Normal events are tiny. The largest are a voice chat's session descriptions, a few kilobytes of
 * text written by the browser; there is no reason to accept more than this per message.
 */
const MAX_EVENT_BYTES = 16_384;

const EVENTS = new Set<string>(CLIENT_EVENTS);

/** The parts of a room that keep their own version, and the field each one travels in. */
const SUBSYSTEMS = { users: "usersVersion", interactions: "interactionVersion", krathongs: "krathongVersion" } as const;
type Unversioned<E extends DeltaEvent> = Omit<Parameters<ServerToClientEvents[E]>[0], VersionFields>;

type Deps = {
  config: Config;
  rooms: RoomService;
  cosmetics: CosmeticService;
  events: EventService;
  log: Logger;
  limiters: Limiters;
  isAllowedOrigin: (origin: string | undefined) => boolean;
  clientIp: (req: import("node:http").IncomingMessage) => string;
};

export function createRealtime(httpServer: HttpServer, { config, rooms, cosmetics, events, log, limiters, isAllowedOrigin, clientIp }: Deps) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    maxHttpBufferSize: MAX_EVENT_BYTES,
    // No CORS headers are sent, so other sites cannot use the API; the origin check also blocks
    // cross-site WebSocket connections, which browsers do not restrict on their own.
    allowRequest: (req, callback) => {
      const allowed = isAllowedOrigin(req.headers.origin);
      if (!allowed) log("ORIGIN_REJECTED", { result: "denied" });
      callback(null, allowed);
    },
  });

  /**
   * The only way shared room state reaches clients. Every change gets the next room version and
   * the server's clock, so a client can tell a duplicate, a late arrival or a gap from the real next update.
   */
  const publish = <E extends DeltaEvent>(room: Room, event: E, payload: Unversioned<E>, part?: keyof typeof SUBSYSTEMS) => {
    room.version++;
    const field = part && SUBSYSTEMS[part];
    const own = field ? { [field]: ++room[field] } : {};
    (io.to(room.code) as unknown as { emit: (name: string, data: unknown) => void }).emit(event, { ...payload, ...own, roomVersion: room.version, serverTime: Date.now() });
  };

  /** An error that is not the answer to an acknowledgement. */
  const sendError = (socket: AppSocket, error: SocketError, event?: string) => socket.emit("socket:error", { error, event, serverTime: Date.now() });

  /** Set when the server is stopping. */
  let closing = false;

  /** Commands that carried an id and were carried out, with the answer they got, kept for a minute so a retry is answered, not repeated. */
  const processed = new Map<string, { at: number; reply: SocketAck<unknown> }>();
  const COMMAND_MEMORY_MS = 60_000;

  /** userId -> recent chat rate-limit hits, and until when the user is muted */
  const chatAbuse = new Map<string, { strikes: number[]; mutedUntil: number }>();

  const publicUser = ({ socketId: _socketId, leaveTimer: _leaveTimer, arrivesAt: _arrivesAt, ...user }: Member): RoomUser => user;

  const SYSTEM_TEXT = {
    joined: (name: string) => `🦆 ${name} waddled in.`,
    left: (name: string) => `${name} waddled away.`,
    owner: (name: string) => `👑 ${name} is now leading the flock.`,
    scene: (name: string) => name,
    radio: (name: string) => name,
  };

  const systemMessage = (room: Room, event: keyof typeof SYSTEM_TEXT, name: string) => {
    const message: ChatMessage = {
      type: "system",
      id: randomUUID(),
      event,
      text: SYSTEM_TEXT[event](name),
      createdAt: Date.now(),
    };
    rooms.addMessage(room, message);
    publish(room, "chat:message", { message });
  };

  /** The whole shared state of a room, as one user should see it. */
  const snapshot = (room: Room, userId: string): RoomState => ({
    roomId: room.id,
    code: room.code,
    createdAt: room.createdAt,
    version: room.version,
    versions: {
      room: room.version,
      users: room.usersVersion,
      music: room.music.version,
      event: events.snapshot().state.version,
      interactions: room.interactionVersion,
      krathongs: room.krathongVersion,
    },
    selfId: userId,
    ownerUserId: room.ownerUserId,
    scene: room.scene,
    users: [...room.users.values()].map(publicUser),
    music: room.music,
    musicSettings: room.musicSettings,
    stations: config.stations,
    event: events.snapshot(),
    inventory: cosmetics.inventory(userId, room),
    krathongs: floating(room),
    voice: [...room.voice].map(([id, { muted }]) => ({ userId: id, muted })),
    serverTime: Date.now(),
  });

  /** Everything one browser needs to show the room: the snapshot, then the recent chat. */
  const sendSnapshot = (socket: AppSocket, room: Room) => {
    socket.emit("room:snapshot", snapshot(room, socket.data.session.userId));
    socket.emit("chat:history", { messages: room.messages, serverTime: Date.now() });
  };

  /** What a duck is doing and carrying, as the server has it. */
  const publishDuckState = (room: Room, member: Member, change: Partial<Pick<DuckStateChangedPayload, "activity" | "interactionId" | "startedAt" | "endsAt">> = {}) =>
    publish(room, "duck:stateChanged", { userId: member.id, activity: "idle", carriedItem: member.carriedItem ?? null, ...change }, "users");

  /** Tells each member what they may wear now. Unlocks depend on the scene and on who leads the room. */
  const refreshInventories = (room: Room) => {
    for (const member of room.users.values()) {
      io.to(member.socketId).emit("cosmetic:inventory", { wearableIds: cosmetics.inventory(member.id, room) });
    }
  };

  /** Everyone sees what a duck wears. Nobody but the duck itself learns what it owns. */
  const broadcastAppearance = (room: Room, member: Member) => {
    publish(room, "duck:appearance", { userId: member.id, appearance: { color: member.duckColor, equipment: member.equipment } }, "users");
  };

  /** The only way music state changes: bumps the version and tells the whole room. */
  const setMusic = (room: Room, change: Partial<Pick<MusicState, "stationId" | "playing" | "tracks">>, byUserId = room.music.changedByUserId) => {
    room.music = { ...room.music, ...change, changedAt: Date.now(), changedByUserId: byUserId, version: room.music.version + 1 };
    publish(room, "music:state", { state: room.music });
  };

  /** The built-in stations, plus the active event's own station while that event is on. */
  const stations = (): Station[] => {
    const id = events.active()?.theme.musicStation;
    return id && !config.stations.some((station) => station.id === id) ? [...config.stations, { id, name: stationName(id), url: null }] : config.stations;
  };

  const playable = (room: Room) => [...stations().map((station) => station.id), ...room.music.tracks.map((track) => track.id)];

  // --- Krathongs -----------------------------------------------------------------

  /** The krathong settings of the active event, or undefined when no event allows them right now. */
  const krathongConfig = () => {
    const settings = events.active()?.interactions?.krathong;
    return settings?.enabled ? settings : undefined;
  };

  /** Krathongs still on the water. Expired ones are dropped from the room as a side effect. */
  const floating = (room: Room): FloatingKrathong[] => {
    const now = Date.now();
    room.krathongs = room.krathongs.filter((item) => item.expiresAt > now);
    return room.krathongs;
  };

  /** Finds a zone of the right kind that this event uses and that the duck is standing at. */
  const zoneFor = (zoneId: string, type: InteractionZoneType, allowed: readonly string[], member: Member) => {
    const zone = INTERACTION_ZONES[zoneId];
    if (!zone || zone.type !== type || !allowed.includes(zoneId)) throw new AppError("OBJECT_NOT_FOUND", "There is nothing to do there");
    // The duck's position is the server's own record of it, not anything in the request.
    if (!inZone(zone, member.x, member.y)) throw new AppError("TOO_FAR", "You are too far away");
    // Its position is already the place it is walking to. Until it gets there, it is not there.
    if (config.requireArrival && Date.now() < (member.arrivesAt ?? 0) - ARRIVAL_SLACK_MS) throw new AppError("TOO_FAR", "Your duck is still on its way there");
    return zone;
  };

  /** Takes a duck out of the voice chat, if it is in it. The others then drop their connection to it. */
  const leaveVoice = (room: Room, userId: string) => {
    if (room.voice.delete(userId)) publish(room, "voice:state", { userId, joined: false, muted: false }, "users");
  };

  const connectedMembers = (room: Room) => [...room.users.values()].filter((member) => member.connected);

  /** If the owner is gone, waits for the grace period, then gives the room to the longest-connected member. */
  const ensureOwner = (room: Room) => {
    const present = (id: string) => !!room.users.get(id)?.connected;
    if (present(room.ownerUserId) || connectedMembers(room).length === 0 || room.ownerTimer) return;
    room.ownerTimer = setTimeout(() => {
      room.ownerTimer = undefined;
      const next = connectedMembers(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (present(room.ownerUserId) || !next) return;
      const previousOwnerUserId = room.ownerUserId;
      room.ownerUserId = next.id;
      publish(room, "room:ownerChanged", { previousOwnerUserId, ownerUserId: next.id }, "users");
      refreshInventories(room);
      systemMessage(room, "owner", next.displayName);
      log("OWNER_CHANGED", { roomId: room.id, userId: next.id, result: "transferred" });
    }, config.ownerGraceMs);
    room.ownerTimer.unref();
  };

  /** Takes a member out of the room for good. */
  const depart = (room: Room, member: Member, reason: UserLeftReason) => {
    clearTimeout(member.leaveTimer);
    if (room.users.get(member.id) !== member) return;
    leaveVoice(room, member.id);
    room.users.delete(member.id);
    room.recentStickers = room.recentStickers.filter((sticker) => sticker.userId !== member.id);
    publish(room, "room:userLeft", { userId: member.id, reason }, "users");
    systemMessage(room, "left", member.displayName);
    log("ROOM_LEAVE", { roomId: room.id, userId: member.id, result: "ok" });
    if (connectedMembers(room).length === 0) rooms.scheduleCleanup(room);
    else ensureOwner(room);
  };

  /**
   * A connection ended. If the user pressed Exit, they leave now. If the connection simply dropped
   * (a reload, a tunnel, a sleeping phone), they stay in the room, marked as away, for a grace
   * period: coming back with the same session picks up the same duck, in the same place.
   */
  const leave = (socket: AppSocket, explicit = false) => {
    // The server is stopping and closes every connection itself: that is nobody leaving, and no timer may start now.
    if (closing) return;
    const { userId } = socket.data.session;
    const room = rooms.find(socket.data.roomCode);
    const member = room?.users.get(userId);
    socket.data.roomCode = undefined;
    if (!room || !member || member.socketId !== socket.id) return;
    socket.leave(room.code);
    // The sound went over this browser's own connections, which are gone with it. A duck that comes back joins the voice chat again.
    leaveVoice(room, userId);

    if (explicit || config.presenceGraceMs === 0) return depart(room, member, explicit ? "LEFT" : "DISCONNECTED");

    member.connected = false;
    publish(room, "room:presence", { userId, connected: false }, "users");
    member.leaveTimer = setTimeout(() => !member.connected && depart(room, member, "TIMEOUT"), config.presenceGraceMs);
    member.leaveTimer.unref();
    if (connectedMembers(room).length === 0) rooms.scheduleCleanup(room);
    else ensureOwner(room);
  };

  const checkChatLimit = (room: Room, userId: string) => {
    const now = Date.now();
    const abuse = chatAbuse.get(userId) ?? { strikes: [], mutedUntil: 0 };
    const tooFast = new AppError("RATE_LIMITED", "You are sending messages too fast. Wait a moment.", Math.max(abuse.mutedUntil - now, limiters.chat.retryAfterMs(userId, now), 1000));
    if (now < abuse.mutedUntil) throw tooFast;
    if (limiters.chat.allow(userId) && limiters.chatSlow.allow(userId)) return;

    // Repeated hits earn a short mute, so hammering the limit does not pay off.
    abuse.strikes = [...abuse.strikes.filter((time) => now - time < 60_000), now];
    if (abuse.strikes.length >= config.chatStrikes) {
      abuse.mutedUntil = now + config.chatCooldownMs;
      abuse.strikes = [];
    }
    chatAbuse.set(userId, abuse);
    log("CHAT_RATE_LIMITED", { roomId: room.id, userId, result: abuse.mutedUntil > now ? "muted" : "rejected" });
    throw tooFast;
  };

  /** Says "too fast", with how long to wait when the limiter knows. */
  const tooFast = (message: string, limiter?: RateLimiter, key?: string) => new AppError("RATE_LIMITED", message, limiter && key ? limiter.retryAfterMs(key) || undefined : undefined);

  /**
   * Registers one command with the full pipeline. `access` decides which checks run before the
   * handler. What the handler returns is sent back as the acknowledgement's `data`.
   */
  function on<S extends ZodType>(socket: AppSocket, event: EventName, schema: S, access: "session", limiter: RateLimiter | null, run: (payload: z.output<S>) => object | void): void;
  function on<S extends ZodType>(socket: AppSocket, event: EventName, schema: S, access: "member" | "music" | "owner", limiter: RateLimiter | null, run: (payload: z.output<S>, context: RoomContext) => object | void): void;
  function on<S extends ZodType>(
    socket: AppSocket,
    event: EventName,
    schema: S,
    access: "session" | "member" | "music" | "owner",
    limiter: RateLimiter | null,
    run: (payload: z.output<S>, context: RoomContext) => object | void,
  ) {
    (socket as { on: (event: string, listener: (...args: unknown[]) => void) => void }).on(event, (...args) => {
      const ack = typeof args.at(-1) === "function" ? (args.pop() as (reply: SocketAck<unknown>) => void) : undefined;
      const { userId } = socket.data.session; // the session was checked when the socket connected
      let commandId: string | undefined;
      try {
        // 1. payload: nothing below ever sees the raw data
        const parsed = args.length > 1 ? null : schema.safeParse(args[0]);
        if (!parsed?.success) throw new AppError("INVALID_PAYLOAD", "That request is not valid");
        const data = parsed.data as { commandId?: string; clientMessageId?: string } | undefined;
        commandId = data?.commandId;
        // 2 + 3. membership and authorization, from the server's own record of the room
        const context = access === "owner" ? requireRoomOwner(socket, rooms) : access === "music" ? requireMusicControl(socket, rooms) : access === "member" ? requireRoomMember(socket, rooms) : undefined;
        // 4. rate limit
        if (limiter && !limiter.allow(userId)) throw tooFast("Slow down a little", limiter, userId);
        // 5. a command that carries an id and was already carried out gets its first answer again
        const repeatId = commandId ?? data?.clientMessageId;
        // The room is part of the key: an id used in one room means nothing in another.
        const memoryKey = repeatId && `${userId}:${context?.room.id ?? ""}:${event}:${repeatId}`;
        const before = memoryKey ? processed.get(memoryKey) : undefined;
        if (before) return ack?.(before.reply);
        // 6. state checks, the change itself and the broadcast
        const result = run(parsed.data, context as RoomContext);
        const reply: SocketAck<unknown> = { ok: true, ...(commandId ? { commandId } : {}), ...(result ? { data: result } : {}) };
        if (memoryKey) processed.set(memoryKey, { at: Date.now(), reply });
        ack?.(reply);
      } catch (caught) {
        const roomId = rooms.find(socket.data.roomCode)?.id;
        let error: SocketError;
        if (caught instanceof AppError) {
          error = { code: caught.code, message: caught.message, ...(caught.retryAfterMs ? { retryAfterMs: caught.retryAfterMs } : {}) };
          // Every refusal is logged with the event, the user, the room and the code. Never the payload.
          if (error.code === "INVALID_PAYLOAD") log("INVALID_SOCKET_EVENT", { roomId, userId, result: error.code, detail: event });
          else if (error.code === "FORBIDDEN") log(event.startsWith("music:") ? "MUSIC_PERMISSION_DENIED" : "PERMISSION_DENIED", { roomId, userId, result: error.code, detail: event });
          else if (error.code === "RATE_LIMITED") {
            // Moves and chat are limited often and chat logs its own line; one line per dropped move would flood the log.
            if (event !== "duck:move" && event !== "chat:message") log("RATE_LIMITED", { roomId, userId, result: error.code, detail: event });
          } else log("COMMAND_REJECTED", { roomId, userId, result: error.code, detail: event });
        } else {
          // Details stay in the server log; the client only gets a generic message.
          log("SERVER_ERROR", { roomId, userId, detail: `${event}: ${caught instanceof Error ? caught.message : "unknown"}` });
          error = { code: "INTERNAL_ERROR", message: "Something went wrong" };
        }
        if (ack) return ack({ ok: false, ...(commandId ? { commandId } : {}), error });
        // No acknowledgement was asked for. A throttled move is dropped quietly: answering each one would only add to the flood.
        if (!(event === "duck:move" && error.code === "RATE_LIMITED")) sendError(socket, error, event);
      }
    });
  }

  // Every connection must carry a valid server-issued session.
  io.use((socket, next) => {
    const ip = clientIp(socket.request);
    if (!limiters.connect.allow(ip)) {
      log("RATE_LIMITED", { detail: "connect" });
      return next(new Error("RATE_LIMITED"));
    }
    const session = readSession(socket.request.headers.cookie, config.sessionSecret);
    if (!session) {
      log("SESSION_INVALID", { result: "rejected" });
      return next(new Error("UNAUTHENTICATED"));
    }
    socket.data.session = session;
    socket.data.ip = ip;
    next();
  });

  io.on("connection", (socket) => {
    const { userId } = socket.data.session;

    socket.use(([event], next) => {
      if (!limiters.socketEvents.allow(socket.id)) return void socket.disconnect(true);
      if (EVENTS.has(event)) return next();
      log("INVALID_SOCKET_EVENT", { userId, detail: "unknown event" });
      sendError(socket, { code: "INVALID_PAYLOAD", message: "Unknown event" });
    });

    const joinLimit = () => {
      if (!limiters.join.allow(userId)) throw tooFast("Too many attempts. Wait a moment.", limiters.join, userId);
      if (!limiters.joinPerIp.allow(socket.data.ip)) throw tooFast("Too many attempts. Wait a moment.", limiters.joinPerIp, socket.data.ip);
    };

    /**
     * Puts this connection's duck in the room and hands it a snapshot. With a profile it is a
     * join; without one it is a returning member, who keeps everything the server has for them.
     */
    const enter = (room: Room, profile?: { displayName: string; duckColor: DuckColorId; heldItem: HeldItemId }) => {
      const existing = room.users.get(userId);
      const look = profile ?? existing;
      if (!look) throw new AppError("NOT_IN_ROOM", "You are not in that room any more");
      if (!existing && room.users.size >= config.maxRoomUsers) throw new AppError("ROOM_FULL", "This room is full");

      // One duck per user: joining again (new tab, reconnect) replaces the older connection.
      const old = existing && io.sockets.sockets.get(existing.socketId);
      if (old && old.id !== socket.id) {
        old.data.roomCode = undefined;
        sendError(old, { code: "CONFLICT", message: "You joined this room from another tab" });
        old.disconnect(true);
        // The voice connections belonged to the old tab.
        leaveVoice(room, userId);
      }

      clearTimeout(existing?.leaveTimer);
      const member: Member = {
        id: userId,
        displayName: look.displayName,
        duckColor: look.duckColor,
        heldItem: look.heldItem,
        equipment: cosmetics.equipmentOf(userId),
        // What the duck carries is the server's own record. A returning member keeps it; nobody can claim it.
        carriedItem: existing?.carriedItem,
        connected: true,
        x: existing?.x ?? 0.2 + Math.random() * 0.6,
        y: existing?.y ?? 0.2 + Math.random() * 0.6,
        socketId: socket.id,
        arrivesAt: existing?.arrivesAt,
        joinedAt: existing?.joinedAt ?? Date.now(),
      };
      room.users.set(userId, member);
      rooms.cancelCleanup(room);
      if (userId === room.ownerUserId) {
        clearTimeout(room.ownerTimer);
        room.ownerTimer = undefined;
      }

      // Tell the room first (the newcomer is not listening yet), then hand the newcomer one snapshot
      // that already includes all of it. Their next update is then exactly one version later.
      publish(room, "room:userJoined", { user: publicUser(member) }, "users");
      if (!existing) systemMessage(room, "joined", member.displayName);
      socket.data.roomCode = room.code;
      socket.join(room.code);
      sendSnapshot(socket, room);
      ensureOwner(room);
      log("ROOM_JOIN", { roomId: room.id, userId, result: existing ? "rejoined" : "ok" });
    };

    /** Finds a room by code. One generic answer for "never existed" and "closed", so codes cannot be probed for details. */
    const roomByCode = (code: string) => {
      if (socket.data.roomCode) throw new AppError("CONFLICT", "Already in a room");
      const room = rooms.find(code);
      if (!room) throw new AppError("ROOM_NOT_FOUND", "We couldn't find that room.");
      return room;
    };

    // The room id, the code and the owner are the server's: the payload cannot name any of them.
    on(socket, "room:create", RoomCreateSchema, "session", null, () => {
      if (!limiters.createRoom.allow(userId)) throw tooFast("Too many rooms. Wait a moment.", limiters.createRoom, userId);
      if (!limiters.createRoomPerIp.allow(socket.data.ip)) throw tooFast("Too many rooms. Wait a moment.", limiters.createRoomPerIp, socket.data.ip);
      const room = rooms.create(userId);
      if (!room) throw new AppError("CONFLICT", "The server is busy. Try again later.");
      cosmetics.rewardHost(userId);
      // A room opened during an event starts on that event's station.
      room.music.stationId = events.active()?.theme.musicStation ?? room.music.stationId;
      return { roomId: room.id, roomCode: room.code };
    });

    on(socket, "room:join", JoinSchema, "session", null, ({ roomCode, displayName, duckColor, heldItem, equipment }) => {
      joinLimit();
      const room = roomByCode(roomCode);
      // The outfit comes from the server's own record. A requested item is used only if it passes
      // the same checks as cosmetic:equip; otherwise the last saved outfit stays.
      if (equipment && (room.users.has(userId) || room.users.size < config.maxRoomUsers)) {
        try {
          if (equipment.head) cosmetics.equip(userId, room, "head", equipment.head);
          else cosmetics.unequip(userId, "head");
        } catch {
          // locked or unknown: keep what was saved
        }
      }
      enter(room, { displayName, duckColor, heldItem });
    });

    // After a reconnect: the same session picks its duck up again, as long as the room still holds it.
    // The versions the client sends are not used to replay anything; a full snapshot is simpler and cannot be wrong.
    on(socket, "room:resume", ResumeSchema, "session", null, ({ roomCode }) => {
      joinLimit();
      enter(roomByCode(roomCode));
    });

    on(socket, "room:leave", CommandSchema, "member", null, () => leave(socket, true));

    // The client noticed a gap in versions, or met something it does not know: send everything again.
    on(socket, "room:resync", ResyncSchema, "member", limiters.resync, ({ roomCode }, { room }) => {
      if (roomCode !== room.code) throw new AppError("NOT_IN_ROOM", "You are not in that room");
      sendSnapshot(socket, room);
    });

    // The duck that moves is always the sender's own: the payload has no user id at all.
    // What is shared is a destination and how long the walk takes, never positions along the way.
    on(socket, "duck:move", MoveSchema, "member", limiters.move, ({ clientMoveId, destination }, { room, member }) => {
      // A duck in the middle of a shared animation stays put until it ends.
      if (Date.now() < (room.interactionLockedUntil.get(userId) ?? 0)) throw new AppError("INVALID_STATE", "Your duck is busy for a moment");
      const from = { x: member.x, y: member.y };
      member.x = Math.min(0.96, Math.max(0.04, destination.x));
      member.y = destination.y;
      const durationMs = walkDurationMs(from, member);
      const now = Date.now();
      // A duck that changes its mind mid-walk sets off again from where the server has it, so the new walk is timed from now.
      member.arrivesAt = now + durationMs;
      const serverMoveId = randomUUID();
      publish(
        room,
        "duck:moved",
        { userId, clientMoveId, serverMoveId, from, destination: { x: member.x, y: member.y }, direction: member.x < from.x ? "left" : "right", startedAt: now, durationMs },
        "users",
      );
      return { serverMoveId };
    });

    on(socket, "duck:item", ItemSchema, "member", limiters.item, ({ heldItem }, { room, member }) => {
      member.heldItem = heldItem;
      publish(room, "duck:item", { userId, heldItem }, "users");
    });

    // Krathongs: take one at the stall, carry it, and set it on the river.
    on(socket, "krathong:pickup", PickupSchema, "member", limiters.krathongPickup, ({ stallId, variant }, { room, member }) => {
      const settings = krathongConfig();
      if (!settings) throw new AppError("EVENT_INACTIVE", "The krathong stall is closed");
      zoneFor(stallId, "krathong-pickup", settings.pickupZones, member);
      if (Date.now() < (room.interactionLockedUntil.get(userId) ?? 0)) throw new AppError("INVALID_STATE", "Wait a moment");
      if (member.carriedItem) throw new AppError("INVALID_STATE", "You are already carrying one");
      if (!isKrathongVariant(variant) || !settings.variants.includes(variant)) throw new AppError("OBJECT_NOT_FOUND", "The stall does not have that one");

      member.carriedItem = { type: "krathong", variant };
      // The duck's own state carries the result; there is no separate "picked up" event.
      publishDuckState(room, member);
    });

    // One step from the room's point of view: the duck stops carrying it and it is on the water.
    on(socket, "krathong:release", ReleaseSchema, "member", limiters.krathongRelease, ({ zoneId }, { room, member }) => {
      const settings = krathongConfig();
      if (!settings) throw new AppError("EVENT_INACTIVE", "The festival is over");
      if (!member.carriedItem) throw new AppError("INVALID_STATE", "You are not carrying a krathong");
      const zone = zoneFor(zoneId, "krathong-release", settings.releaseZones, member);

      const now = Date.now();
      // Forget waits that are over, so these lists do not grow for as long as the room lives.
      for (const waits of [room.interactionLockedUntil, room.krathongCooldownUntil]) for (const [id, until] of waits) if (until <= now) waits.delete(id);
      if (now < (room.interactionLockedUntil.get(userId) ?? 0)) throw new AppError("INVALID_STATE", "Wait a moment");
      const cooldown = (room.krathongCooldownUntil.get(userId) ?? 0) - now;
      if (cooldown > 0) throw new AppError("RATE_LIMITED", "Wait a little before floating another", cooldown);

      // Keep the river from filling up: the oldest krathong makes room for the new one.
      const afloat = floating(room);
      for (const old of afloat.splice(0, Math.max(0, afloat.length - settings.maxFloatingPerRoom + 1))) {
        publish(room, "krathong:removed", { krathongId: old.id, reason: "ROOM_CLEANUP" }, "krathongs");
      }

      // Everything about the new krathong is decided here: where it starts, which way it drifts, how fast, and when it goes.
      const startY = zone.waterY ?? zone.y;
      const createdAt = now + PLACE_MS;
      const krathong: FloatingKrathong = {
        id: randomUUID(),
        ownerUserId: userId,
        variant: member.carriedItem.variant,
        startX: member.x,
        startY,
        driftX: 0.03 + Math.random() * 0.03, // downstream
        driftY: (0.46 - startY) * 0.015, // and slowly toward the middle of the river
        driftSpeed: 0.6,
        createdAt,
        expiresAt: createdAt + settings.floatDurationMs,
      };
      afloat.push(krathong);

      member.carriedItem = undefined;
      // The duck is busy setting it down: no walking, stickers or new pickups until it is done.
      room.interactionLockedUntil.set(userId, now + RELEASE_MS);
      room.krathongCooldownUntil.set(userId, now + settings.userCooldownMs);

      // Both updates carry the same interaction id, so a client can tell they are one action.
      const interactionId = randomUUID();
      publishDuckState(room, member, { activity: "releasing-krathong", interactionId, startedAt: now, endsAt: now + RELEASE_MS });
      publish(room, "krathong:spawned", { krathong, interactionId }, "krathongs");
      return { krathongId: krathong.id, interactionId };
    });

    // Stickers. Everyone sees a sticker; if another duck sent the same one a moment ago,
    // the server pairs the two and starts a shared animation. Clients never choose the partner.
    on(socket, "sticker:send", StickerSchema, "member", null, ({ stickerId }, { room, member }) => {
      // Seasonal stickers work only while their event is the active one, by the server's calendar.
      if (!stickerAvailable(stickerId, events.active()?.slug)) throw new AppError("EVENT_INACTIVE", "That sticker is out of season");
      if (!limiters.sticker.allow(userId)) throw tooFast("Slow down a little", limiters.sticker, userId);
      if (!limiters.stickerSlow.allow(userId)) throw tooFast("Slow down a little", limiters.stickerSlow, userId);

      const now = Date.now();
      const { matchWindowMs, pairCooldownMs, startDelayMs } = config.stickers;
      publish(room, "sticker:sent", { stickerEventId: randomUUID(), userId, stickerId, createdAt: now });

      // Forget stickers that are too old, or whose sender has left.
      room.recentStickers = room.recentStickers.filter((sticker) => now - sticker.sentAt <= matchWindowMs && room.users.has(sticker.userId));
      const busy = (id: string) => now < (room.interactionLockedUntil.get(id) ?? 0);
      const pairKey = (other: string) => [userId, other].sort().join("|");

      // The first earlier sticker that fits wins: same sticker, a different duck, both free,
      // and not the same pair that has just matched.
      const match = room.recentStickers.find(
        (sticker) => sticker.stickerId === stickerId && sticker.userId !== userId && !busy(sticker.userId) && now >= (room.pairCooldownUntil.get(pairKey(sticker.userId)) ?? 0),
      );
      const found = match && room.users.get(match.userId);
      const partner = found?.connected ? found : undefined; // a duck that is away cannot be paired

      if (!match || !partner || busy(userId)) {
        // No partner yet: remember this sticker (one per user) so the next duck can match it.
        room.recentStickers = [...room.recentStickers.filter((sticker) => sticker.userId !== userId), { userId, stickerId, sentAt: now }];
        return;
      }

      // Both stickers are used up, so a third duck sending the same one does not join this pair.
      room.recentStickers = room.recentStickers.filter((sticker) => sticker !== match && sticker.userId !== userId);

      const durationMs = STICKERS[stickerId].durationMs;
      const startedAt = now + startDelayMs; // a small head start, so every client can begin at the same moment
      for (const id of [userId, partner.id]) room.interactionLockedUntil.set(id, startedAt + durationMs);
      room.pairCooldownUntil.set(pairKey(partner.id), now + pairCooldownMs);
      for (const [key, until] of room.pairCooldownUntil) if (until < now) room.pairCooldownUntil.delete(key);

      const event: Unversioned<"sticker:match"> = {
        interactionId: randomUUID(),
        stickerId,
        interactionType: STICKERS[stickerId].interaction,
        userA: partner.id,
        userB: userId,
        startedAt,
        durationMs,
        mode: "apart",
      };

      // Ducks that are close walk to meet each other. Ducks far apart are never dragged across the room.
      if (Math.hypot(member.x - partner.x, member.y - partner.y) < MAX_INTERACTION_MOVE_DISTANCE) {
        const [left, right] = partner.x <= member.x ? [partner, member] : [member, partner];
        const middle = Math.min(0.96 - MEETING_GAP, Math.max(0.04 + MEETING_GAP, (left.x + right.x) / 2));
        const y = (left.y + right.y) / 2;
        left.x = middle - MEETING_GAP;
        right.x = middle + MEETING_GAP;
        left.y = right.y = y;
        event.mode = "together";
        event.positions = { [left.id]: { x: left.x, y }, [right.id]: { x: right.x, y } };
      }
      publish(room, "sticker:match", event, "interactions");
    });

    on(socket, "chat:message", MessageSchema, "member", null, ({ text, clientMessageId }, { room, member }) => {
      if ([...text].length > config.maxMessageLength) throw new AppError("INVALID_PAYLOAD", "That message is too long");
      checkChatLimit(room, userId);
      // Name, color and time come from the server's own records, never from the payload.
      const message: ChatMessage = {
        type: "user",
        id: randomUUID(),
        userId,
        displayName: member.displayName,
        duckColor: member.duckColor,
        text,
        createdAt: Date.now(),
      };
      rooms.addMessage(room, message);
      // The sender's own id for this message rides along, so it can recognise it. It is not stored.
      publish(room, "chat:message", { message, clientMessageId });
      return { messageId: message.id };
    });

    // The owner decides which world the room is set in. Everyone sees the same one.
    on(socket, "room:scene", SceneSchema, "owner", limiters.music, ({ scene }, { room }) => {
      if (room.scene === scene) return;
      room.scene = scene;
      publish(room, "room:settingsChanged", { settings: { scene } });
      refreshInventories(room);
      systemMessage(room, "scene", scene === "festival" ? "🚣 The Boat Festival has begun!" : "The valley is quiet again.");
    });

    on(socket, "cosmetic:equip", EquipSchema, "member", limiters.item, ({ slot, wearableId }, { room, member }) => {
      member.equipment = cosmetics.equip(userId, room, slot, wearableId);
      broadcastAppearance(room, member);
    });

    on(socket, "cosmetic:unequip", UnequipSchema, "member", limiters.item, ({ slot }, { room, member }) => {
      member.equipment = cosmetics.unequip(userId, slot);
      broadcastAppearance(room, member);
    });

    // Voice chat. The server keeps the list of who is in it and introduces them to each other; the
    // sound itself goes directly between their browsers and is never seen here.
    on(socket, "voice:join", VoiceMuteSchema, "member", limiters.voiceJoin, ({ muted }, { room }) => {
      // Joining again means this browser is starting over: the others drop what they had for it first.
      leaveVoice(room, userId);
      if (room.voice.size >= config.maxVoiceUsers) throw new AppError("ROOM_FULL", "The voice chat is full");
      const peers = [...room.voice.keys()];
      room.voice.set(userId, { muted });
      publish(room, "voice:state", { userId, joined: true, muted }, "users");
      // The newcomer calls everyone who is already there, so each pair connects exactly once.
      return { peers, iceServers: config.iceServers };
    });

    on(socket, "voice:leave", NoPayloadSchema, "member", null, (_payload, { room }) => leaveVoice(room, userId));

    // The microphone is switched off in the sender's own browser. This only tells the room, so ducks can show it.
    on(socket, "voice:mute", VoiceMuteSchema, "member", limiters.voiceMute, ({ muted }, { room }) => {
      const mine = room.voice.get(userId);
      if (!mine) throw new AppError("INVALID_STATE", "Join the voice chat first");
      if (mine.muted === muted) return;
      mine.muted = muted;
      publish(room, "voice:state", { userId, joined: true, muted }, "users");
    });

    // Passed on to one duck, and only between two ducks who are both in this room's voice chat.
    // The receiver learns who it is from by the server's word, never from the payload.
    on(socket, "voice:signal", VoiceSignalSchema, "member", limiters.voiceSignal, ({ to, signal }, { room }) => {
      const target = room.users.get(to);
      if (to === userId || !target?.connected || !room.voice.has(userId) || !room.voice.has(to)) throw new AppError("OBJECT_NOT_FOUND", "That duck is not in the voice chat");
      io.to(target.socketId).emit("voice:signal", { from: userId, signal });
    });

    // Shared radio. "music" access means: the owner, a DJ, or any member when the room allows everyone.
    // When members share control, their changes are spaced out so a crowd cannot skip through stations.
    const sharedTurn = (room: Room) => {
      if (userId === room.ownerUserId) return;
      const now = Date.now();
      const wait = room.lastSharedMusicChange + config.musicSharedCooldownMs - now;
      if (wait > 0) throw new AppError("RATE_LIMITED", "Someone just changed the music. Wait a moment.", wait);
      room.lastSharedMusicChange = now;
    };

    on(socket, "music:play", CommandSchema, "music", limiters.musicToggle, (_payload, { room }) => {
      sharedTurn(room);
      setMusic(room, { playing: true }, userId);
    });
    on(socket, "music:pause", CommandSchema, "music", limiters.musicToggle, (_payload, { room }) => {
      sharedTurn(room);
      setMusic(room, { playing: false }, userId);
    });

    on(socket, "music:next", CommandSchema, "music", limiters.musicNext, (_payload, { room }) => {
      sharedTurn(room);
      const ids = playable(room);
      setMusic(room, { stationId: ids[(ids.indexOf(room.music.stationId) + 1) % ids.length] }, userId);
    });

    on(socket, "music:station", StationSchema, "music", limiters.musicStation, ({ stationId }, { room }) => {
      // Only an id from the server's own list is accepted. A URL is never taken from a client.
      if (!playable(room).includes(stationId)) throw new AppError("INVALID_STATE", "Unknown station");
      sharedTurn(room);
      setMusic(room, { stationId }, userId);
    });

    // Who may control the radio is the owner's decision alone. A DJ cannot appoint other DJs.
    const publishSettings = (room: Room) => publish(room, "music:permissions", { mode: room.musicSettings.controlMode, djUserIds: room.musicSettings.djUserIds }, "users");

    on(socket, "music:permission:setMode", MusicModeSchema, "owner", limiters.music, ({ mode }, { room }) => {
      if (room.musicSettings.controlMode === mode) return;
      room.musicSettings = { ...room.musicSettings, controlMode: mode };
      publishSettings(room);
      systemMessage(room, "radio", mode === "EVERYONE" ? "📻 Everyone can control the radio now." : mode === "DJ_ONLY" ? "📻 The owner and DJs control the radio now." : "📻 Only the owner controls the radio now.");
    });

    on(socket, "music:permission:addDJ", DJSchema, "owner", limiters.music, ({ targetUserId: target }, { room }) => {
      const dj = room.users.get(target);
      // Only someone who is in the room right now can be made a DJ.
      if (!dj || target === room.ownerUserId) throw new AppError("OBJECT_NOT_FOUND", "That duck is not in the room");
      if (room.musicSettings.djUserIds.includes(target)) return;
      room.musicSettings = { ...room.musicSettings, djUserIds: [...room.musicSettings.djUserIds, target] };
      publishSettings(room);
      systemMessage(room, "radio", `🎧 ${dj.displayName} is now a DJ.`);
    });

    on(socket, "music:permission:removeDJ", DJSchema, "owner", limiters.music, ({ targetUserId: target }, { room }) => {
      if (!room.musicSettings.djUserIds.includes(target)) return;
      room.musicSettings = { ...room.musicSettings, djUserIds: room.musicSettings.djUserIds.filter((id) => id !== target) };
      publishSettings(room);
    });

    // A member asks for DJ access. Only the owner hears about it, and only the owner can grant it.
    on(socket, "music:requestDJ", NoPayloadSchema, "member", limiters.requestDJ, (_payload, { room }) => {
      const owner = room.users.get(room.ownerUserId);
      if (owner && owner.id !== userId) io.to(owner.socketId).emit("music:djRequest", { userId });
    });

    on(socket, "music:removeTrack", RemoveTrackSchema, "owner", limiters.music, ({ trackId }, { room }) => {
      const track = room.music.tracks.find((item) => item.id === trackId);
      if (!track) throw new AppError("OBJECT_NOT_FOUND", "Unknown track");
      room.uploads.delete(track.url);
      deleteUpload(track.url);
      setMusic(
        room,
        { tracks: room.music.tracks.filter((item) => item.id !== trackId), stationId: room.music.stationId === trackId ? config.stations[0].id : room.music.stationId },
        userId,
      );
    });

    socket.on("disconnect", () => leave(socket));
  });

  // The calendar changed: tell everyone, and bring each room in line with the new event.
  events.onChange((change, snapshot) => {
    io.emit(`event:${change}`, snapshot);
    io.emit("event:state", snapshot);
    for (const room of rooms.all()) {
      refreshInventories(room);
      // The old event's station is gone: fall back to a normal one.
      if (!playable(room).includes(room.music.stationId)) setMusic(room, { stationId: config.stations[0].id });
      // The festival that allowed krathongs is over: ducks put them down and the river is cleared.
      if (!krathongConfig()) {
        for (const member of room.users.values()) {
          if (!member.carriedItem) continue;
          member.carriedItem = undefined;
          publishDuckState(room, member);
        }
        for (const item of floating(room)) publish(room, "krathong:removed", { krathongId: item.id, reason: "EVENT_ENDED" }, "krathongs");
        room.krathongs = [];
        room.krathongCooldownUntil.clear();
      }
    }
  });

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const limiter of Object.values(limiters)) limiter.sweep(now);
    for (const [key, { at }] of processed) if (now - at > COMMAND_MEMORY_MS) processed.delete(key);
    for (const [id, abuse] of chatAbuse) {
      if (abuse.mutedUntil < now && abuse.strikes.every((time) => now - time >= 60_000)) chatAbuse.delete(id);
    }
  }, 60_000);
  sweeper.unref();

  return {
    io,
    /** Called by the upload endpoint after the owner's file passed every check. */
    addTrack(room: Room, track: Track) {
      setMusic(room, { tracks: [...room.music.tracks, track], stationId: track.id }, room.ownerUserId);
    },
    close() {
      closing = true;
      clearInterval(sweeper);
      // Nothing may fire after the server has stopped: not a room's clean-up, not an owner hand-over, not a duck's grace period.
      for (const room of rooms.all()) {
        clearTimeout(room.cleanupTimer);
        clearTimeout(room.ownerTimer);
        for (const member of room.users.values()) clearTimeout(member.leaveTimer);
      }
      return io.close();
    },
  };
}

export type Realtime = ReturnType<typeof createRealtime>;
