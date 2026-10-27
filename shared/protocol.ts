// The contract between the browser and the server: validation schemas, event names and types.
// Both sides import this file, so the two can never disagree.
import { z } from "zod";
import { JoinEquipmentSchema, type Equipment } from "./cosmetics";
import type { EventSnapshot } from "./events";
import type { CarriedItem, FloatingKrathong } from "./interactions";
import type { VoiceParticipant } from "./voice";

export const DUCK_COLORS = [
  "yellow",
  "white",
  "pink",
  "blue",
  "mint",
  "purple",
  "orange",
  "red",
  "black",
  "brown",
  "rainbow",
  "gold",
] as const;
export type DuckColorId = (typeof DUCK_COLORS)[number];

/** Things a duck can hold. Like colors, this is an allowlist: the server accepts only these ids. */
export const HELD_ITEMS = ["none", "beer", "sword", "flower", "gun"] as const;
export type HeldItemId = (typeof HELD_ITEMS)[number];

/** The worlds a room can be set in. The owner picks one; the server accepts only these ids. */
export const SCENES = ["valley", "festival"] as const;
export type SceneId = (typeof SCENES)[number];

/** Who may control the shared radio. The owner always can. */
export const MUSIC_CONTROL_MODES = ["OWNER_ONLY", "DJ_ONLY", "EVERYONE"] as const;
export type MusicControlMode = (typeof MUSIC_CONTROL_MODES)[number];
export type RoomMusicSettings = { controlMode: MusicControlMode; djUserIds: string[] };

/**
 * The one rule for controlling music, used by the server to decide and by the browser to
 * choose which buttons to show. The server's answer is the one that counts.
 */
export function canControlMusic(room: { ownerUserId: string; musicSettings: RoomMusicSettings }, userId: string): boolean {
  if (room.ownerUserId === userId) return true;
  if (room.musicSettings.controlMode === "EVERYONE") return true;
  return room.musicSettings.controlMode === "DJ_ONLY" && room.musicSettings.djUserIds.includes(userId);
}

export const LIMITS = { displayName: 24, message: 300, trackName: 40, roomCode: 8 } as const;

/** No 0/O or 1/I, so codes are easy to read aloud. 32 symbols x 8 places = 40 bits. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Control characters and text-direction overrides. Emoji joiners (U+200D) are allowed.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const UNSAFE_CHARS_ALL = new RegExp(UNSAFE_CHARS.source, "g");
const length = (text: string) => [...text].length; // counts an emoji as one character

/** A short single-line label: rejected if it holds control characters. */
const label = (max: number) =>
  z
    .string()
    .max(max * 8)
    .transform((text) => text.normalize("NFC").trim())
    .refine((text) => !UNSAFE_CHARS.test(text) && length(text) >= 1 && length(text) <= max);

export const DisplayNameSchema = label(LIMITS.displayName);
export const TrackNameSchema = label(LIMITS.trackName);

/** Chat is plain text: line breaks become spaces and other control characters are removed. */
export const ChatTextSchema = z
  .string()
  .max(LIMITS.message * 8)
  .transform((text) => text.normalize("NFC").replace(/[\r\n\t]+/g, " ").replace(UNSAFE_CHARS_ALL, "").trim())
  .refine((text) => length(text) >= 1 && length(text) <= LIMITS.message);

export const RoomCodeSchema = z
  .string()
  .max(32)
  .transform((code) => code.trim().toUpperCase())
  .refine((code) => code.length === LIMITS.roomCode && [...code].every((char) => ROOM_CODE_ALPHABET.includes(char)));

/** An id the client makes up for a command, so a retry of the same command is not carried out twice. */
const commandId = z.uuid();

/** A place in the room: both numbers run from 0 to 1. z.number() already rejects NaN and Infinity. */
const coordinate = z.number().min(0).max(1);
export const PositionSchema = z.strictObject({ x: coordinate, y: coordinate });
export type Position = z.infer<typeof PositionSchema>;

// Strict objects: extra fields such as userId, role or isOwner make the whole payload invalid.
/** No room id, code or owner here: the server makes those up. */
export const RoomCreateSchema = z.strictObject({ commandId, displayName: DisplayNameSchema, duckColor: z.enum(DUCK_COLORS) });
export const JoinSchema = z.strictObject({
  roomCode: RoomCodeSchema,
  displayName: DisplayNameSchema,
  duckColor: z.enum(DUCK_COLORS),
  heldItem: z.enum(HELD_ITEMS).default("none"),
  /** What the duck would like to wear. The server keeps it only if the item is unlocked. */
  equipment: JoinEquipmentSchema.optional(),
});
const version = z.number().int().min(0);
export const ResumeSchema = z.strictObject({
  roomCode: RoomCodeSchema,
  /** Informative only: the answer is always a full snapshot. */
  lastKnownVersions: z.strictObject({ room: version, users: version, music: version, event: version, interactions: version, krathongs: version }).partial().optional(),
});
export const RESYNC_REASONS = ["VERSION_GAP", "UNKNOWN_OBJECT", "RECONNECT", "MANUAL"] as const;
export const ResyncSchema = z.strictObject({ roomCode: RoomCodeSchema, reason: z.enum(RESYNC_REASONS) });
/** For commands with nothing to say except their id: leave, play, pause, next. */
export const CommandSchema = z.strictObject({ commandId });
export const MusicModeSchema = z.strictObject({ commandId, mode: z.enum(MUSIC_CONTROL_MODES) });
/** A target user id is allowed here because the owner is acting on another member. The server still checks both. */
export const DJSchema = z.strictObject({ commandId, targetUserId: z.uuid() });
export const SceneSchema = z.strictObject({ scene: z.enum(SCENES) });
export const ItemSchema = z.strictObject({ heldItem: z.enum(HELD_ITEMS) });
export const MoveSchema = z.strictObject({ clientMoveId: z.uuid(), destination: PositionSchema });
export const MessageSchema = z.strictObject({ clientMessageId: z.uuid(), text: ChatTextSchema });
export const StationSchema = z.strictObject({ commandId, stationId: z.string().min(1).max(64) });
export const RemoveTrackSchema = z.strictObject({ trackId: z.uuid() });
/** For events that carry no data. */
export const NoPayloadSchema = z.undefined();

export type RoomUser = {
  id: string;
  displayName: string;
  duckColor: DuckColorId;
  heldItem: HeldItemId;
  equipment: Equipment;
  /** Something the duck is carrying, such as a krathong. Set only by the server. */
  carriedItem?: CarriedItem;
  /** False while the user's connection is down but they are still held in the room (the reconnect grace period). */
  connected: boolean;
  joinedAt: number;
  x: number;
  y: number;
};

/** How a duck looks to everyone. Never includes what the user owns, only what is worn. */
export type DuckAppearance = { color: DuckColorId; equipment: Equipment };

export type ChatMessage =
  | { type: "user"; id: string; userId: string; displayName: string; duckColor: DuckColorId; text: string; createdAt: number }
  | { type: "system"; id: string; event: "joined" | "left" | "owner" | "scene" | "radio"; text: string; createdAt: number };

/** A built-in station. `url` is null when the browser generates the music itself. */
export type Station = { id: string; name: string; url: string | null };
/** A song uploaded by the room owner. */
export type Track = { id: string; name: string; url: string };

export type MusicState = {
  stationId: string; // a station id or a track id
  playing: boolean;
  changedAt: number;
  /** Who made the latest change, for "Started by Bow". Empty until someone touches the radio. */
  changedByUserId: string;
  version: number; // grows with every change; ignore updates older than the one you have
  tracks: Track[];
};

export type RoomState = {
  roomId: string;
  code: string;
  createdAt: number;
  /** The room version this snapshot is at. The next update will be exactly one higher. */
  version: number;
  /** Parts of the state that keep their own count. */
  versions: RoomVersions;
  selfId: string;
  ownerUserId: string;
  scene: SceneId;
  users: RoomUser[];
  music: MusicState;
  musicSettings: RoomMusicSettings;
  stations: Station[];
  /** The seasonal event that is on right now, if any, with its full configuration. */
  event: EventSnapshot;
  /** Wearable ids you may equip here. This is your own list; other users never receive it. */
  inventory: string[];
  /** Krathongs floating on the river right now. */
  krathongs: FloatingKrathong[];
  /** Who is in the voice chat right now. */
  voice: VoiceParticipant[];
  /** The server's clock when this was sent, so timed animations can start together on every screen. */
  serverTime: number;
};

/** Each part of a room counts its own changes. A snapshot carries all of them. */
export type RoomVersions = { room: number; users: number; music: number; event: number; interactions: number; krathongs: number };

// The event maps, acknowledgements and error codes live in shared/socket.
export * from "./socket";
