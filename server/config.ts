import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { loadStations } from "../config/music";
import { SCENES, type SceneId, type Station } from "../shared/protocol";
import type { IceServer } from "../shared/voice";

export type Limit = { limit: number; windowMs: number };

export type Config = {
  production: boolean;
  port: number;
  /** The one browser origin allowed to talk to this server in production. */
  appOrigin: string | null;
  sessionSecret: string;
  /** Read the visitor's IP from proxy headers (Cloudflare, nginx). Only enable behind a proxy you control. */
  trustProxy: boolean;
  maxRoomUsers: number;
  maxRooms: number;
  /**
   * Ducks in one room's voice chat. Every talker sends their sound to every other one directly,
   * so the work for each browser grows with this number. Keep it small.
   */
  maxVoiceUsers: number;
  /** Handed to browsers that join the voice chat, so they can find a path to each other. */
  iceServers: IceServer[];
  maxMessageLength: number;
  emptyRoomTtlMs: number;
  ownerGraceMs: number;
  stations: Station[];
  /** The scene new rooms start in, and the one the home page shows. */
  defaultScene: SceneId;
  /** Treat this event as active whatever its dates say. For testing, or for sharing a preview with friends. */
  forceEvent: string | undefined;
  /** Where admin changes to events are saved. */
  dataDir: string;
  /** The password for /admin/events. Admin is switched off when this is empty. */
  /** Separate limits per kind of action: movement is naturally much more frequent than chat. */
  limits: {
    connect: Limit; // per IP
    join: Limit; // per user
    joinPerIp: Limit;
    move: Limit;
    chat: Limit;
    chatSlow: Limit;
    music: Limit; // owner housekeeping: scene, removing songs, permissions
    musicToggle: Limit; // play / pause
    musicStation: Limit;
    musicNext: Limit;
    requestDJ: Limit;
    krathongPickup: Limit;
    krathongRelease: Limit;
    resync: Limit;
    item: Limit;
    createRoom: Limit; // per user
    createRoomPerIp: Limit;
    upload: Limit;
    adminLogin: Limit; // per IP
    sticker: Limit;
    stickerSlow: Limit;
    voiceJoin: Limit;
    voiceMute: Limit;
    voiceSignal: Limit; // a join sends a burst: one offer and a few batches of paths per duck already talking
    socketEvents: Limit; // hard cap on all events from one connection
  };
  /** After this many chat rate-limit hits in a minute, the user is muted for chatCooldownMs. */
  chatStrikes: number;
  chatCooldownMs: number;
  /** When members share the radio, their changes must be at least this far apart (the owner is exempt). */
  musicSharedCooldownMs: number;
  /**
   * How long a user whose connection dropped is kept in the room (position, DJ role, carried item)
   * before being removed. A reload or a short network break does not make them leave and rejoin.
   */
  presenceGraceMs: number;
  /**
   * A duck must have finished walking to a zone before it can act there (take or float a krathong).
   * Always on for a real server. Tests that are not about walking turn it off, so they need not wait for each walk.
   */
  requireArrival: boolean;
  /** Sticker matching: how close in time two stickers must be, how long the same pair must wait, and the head start clients get. */
  stickers: { matchWindowMs: number; pairCooldownMs: number; startDelayMs: number };
};

const int = (value: string | undefined, fallback: number, min = 1) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

const list = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

/**
 * STUN tells a browser its own public address, which is enough for most home networks. On mobile
 * data and office networks there is often no direct path at all: then only TURN, which relays the sound, works.
 */
function loadIceServers(env: NodeJS.ProcessEnv): IceServer[] {
  const stun = list(env.STUN_URLS || "stun:stun.l.google.com:19302");
  const turn = list(env.TURN_URLS);
  return [{ urls: stun }, ...(turn.length ? [{ urls: turn, username: env.TURN_USERNAME ?? "", credential: env.TURN_PASSWORD ?? "" }] : [])];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const appOrigin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : null;

  if (production && !appOrigin) throw new Error("APP_ORIGIN is required in production (e.g. https://duckroom.example.com)");
  if (production && (env.SESSION_SECRET?.length ?? 0) < 32) throw new Error("SESSION_SECRET is required in production (32+ random characters)");

  return {
    production,
    port: int(env.PORT, 3000),
    appOrigin,
    // In development a new secret per start is fine: sessions simply reset on restart.
    sessionSecret: env.SESSION_SECRET || randomBytes(32).toString("hex"),
    trustProxy: env.TRUST_PROXY === "true",
    maxRoomUsers: int(env.MAX_ROOM_USERS, 50),
    maxRooms: int(env.MAX_ROOMS, 1000),
    maxVoiceUsers: int(env.MAX_VOICE_USERS, 8, 2),
    iceServers: loadIceServers(env),
    maxMessageLength: Math.min(int(env.MAX_MESSAGE_LENGTH, 300), 300),
    emptyRoomTtlMs: int(env.EMPTY_ROOM_TTL_SECONDS, 300) * 1000,
    ownerGraceMs: int(env.OWNER_GRACE_SECONDS, 30) * 1000,
    stations: loadStations(env),
    defaultScene: SCENES.find((scene) => scene === env.DEFAULT_SCENE) ?? "valley",
    forceEvent: env.FORCE_EVENT || undefined,
    dataDir: env.DATA_DIR || "data",
    limits: {
      connect: { limit: 30, windowMs: 60_000 },
      join: { limit: 10, windowMs: 60_000 },
      joinPerIp: { limit: 30, windowMs: 60_000 },
      move: { limit: 20, windowMs: 1000 },
      chat: { limit: 5, windowMs: 5000 },
      chatSlow: { limit: 20, windowMs: 60_000 },
      music: { limit: 20, windowMs: 10_000 },
      musicToggle: { limit: 5, windowMs: 10_000 },
      musicStation: { limit: 3, windowMs: 10_000 },
      musicNext: { limit: 3, windowMs: 10_000 },
      requestDJ: { limit: 1, windowMs: 30_000 },
      krathongPickup: { limit: 4, windowMs: 60_000 },
      krathongRelease: { limit: 4, windowMs: 60_000 },
      resync: { limit: 5, windowMs: 10_000 },
      item: { limit: 10, windowMs: 10_000 },
      createRoom: { limit: 5, windowMs: 60_000 },
      createRoomPerIp: { limit: 20, windowMs: 3_600_000 },
      upload: { limit: 5, windowMs: 60_000 },
      adminLogin: { limit: 5, windowMs: 60_000 },
      sticker: { limit: 1, windowMs: 1000 },
      stickerSlow: { limit: 10, windowMs: 60_000 },
      voiceJoin: { limit: 6, windowMs: 10_000 },
      voiceMute: { limit: 20, windowMs: 10_000 },
      voiceSignal: { limit: 200, windowMs: 10_000 },
      socketEvents: { limit: 100, windowMs: 1000 },
    },
    chatStrikes: 3,
    chatCooldownMs: 30_000,
    musicSharedCooldownMs: 1500,
    presenceGraceMs: int(env.PRESENCE_GRACE_SECONDS, 30, 0) * 1000,
    requireArrival: true,
    stickers: { matchWindowMs: 3000, pairCooldownMs: 5000, startDelayMs: 150 },
  };
}

/** Reads .env and .env.local the same way Next.js does. */
export function loadEnvFiles() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
}
