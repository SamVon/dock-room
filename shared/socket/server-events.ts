// Everything the server sends. These are the only messages that change what a browser shows as shared state.
import type { EventSnapshot } from "../events";
import type { CarriedItem, FloatingKrathong } from "../interactions";
import type { ChatMessage, DuckAppearance, HeldItemId, MusicControlMode, MusicState, Position, RoomState, RoomUser, SceneId } from "../protocol";
import type { StickerId } from "../stickers";
import type { VoiceSignal } from "../voice";
import type { SocketErrorPayload } from "./errors";

/**
 * Added to every update that changes shared room state. `roomVersion` is the update's place in
 * the room's single order: a client applies the next number, ignores old ones and resyncs on a jump.
 */
export type Delta<T> = T & { roomVersion: number; serverTime: number };
/** Updates about the people in the room also carry the users version. */
type UsersDelta<T> = Delta<T & { usersVersion: number }>;

export type DuckActivity = "idle" | "walking" | "dancing" | "sticker-interaction" | "releasing-krathong";
export type UserLeftReason = "LEFT" | "DISCONNECTED" | "TIMEOUT" | "KICKED";
export type KrathongRemovedReason = "EXPIRED" | "OUT_OF_BOUNDS" | "EVENT_ENDED" | "ROOM_CLEANUP";
export type RoomSettings = { scene: SceneId };

export type RoomSnapshotPayload = RoomState;
export type UserJoinedPayload = UsersDelta<{ user: RoomUser }>;
export type UserLeftPayload = UsersDelta<{ userId: string; reason: UserLeftReason }>;
/** A user's connection dropped or came back while they are still held in the room. */
export type PresencePayload = UsersDelta<{ userId: string; connected: boolean }>;
export type OwnerChangedPayload = UsersDelta<{ previousOwnerUserId: string | null; ownerUserId: string }>;
export type RoomSettingsChangedPayload = Delta<{ settings: RoomSettings }>;
/** A duck has a new destination. Clients animate toward it; positions along the way are never sent. */
export type DuckMovedPayload = UsersDelta<{
  userId: string;
  clientMoveId?: string;
  serverMoveId: string;
  from: Position;
  destination: Position;
  direction: "left" | "right";
  startedAt: number;
  durationMs: number;
}>;
/** What a duck is doing and carrying changed. `interactionId` ties it to the event that caused it. */
export type DuckStateChangedPayload = UsersDelta<{
  userId: string;
  activity: DuckActivity;
  carriedItem: CarriedItem | null;
  interactionId?: string;
  startedAt?: number;
  endsAt?: number;
}>;
export type ChatMessagePayload = Delta<{ message: ChatMessage; clientMessageId?: string }>;
/** The recent messages, sent to one browser together with each snapshot. At most 100. */
export type ChatHistoryPayload = { messages: ChatMessage[]; serverTime: number };
export type StickerSentPayload = Delta<{ stickerEventId: string; userId: string; stickerId: StickerId; createdAt: number }>;
export type StickerMatchPayload = Delta<{
  interactionId: string;
  stickerId: StickerId;
  interactionType: string;
  userA: string;
  userB: string;
  /** Server time when the animation begins, a moment in the future so every client can start together. */
  startedAt: number;
  durationMs: number;
  /** "together": the ducks were close and have walked to meet. "apart": they react from where they are. */
  mode: "together" | "apart";
  /** Where the two ducks stand for a "together" interaction. The server has already moved them there. */
  positions?: Record<string, Position>;
  interactionVersion: number;
}>;
export type MusicStatePayload = Delta<{ state: MusicState }>;
export type MusicPermissionsPayload = UsersDelta<{ mode: MusicControlMode; djUserIds: string[] }>;
/** A duck joined or left the voice chat, or switched its microphone. `muted` is false when it left. */
export type VoiceStatePayload = UsersDelta<{ userId: string; joined: boolean; muted: boolean }>;
export type KrathongSpawnedPayload = Delta<{ krathong: FloatingKrathong; interactionId: string; krathongVersion: number }>;
/** Removing is safe to repeat: an id that is already gone is ignored. */
export type KrathongRemovedPayload = Delta<{ krathongId: string; reason: KrathongRemovedReason; krathongVersion: number }>;

export interface ServerToClientEvents {
  /** The whole shared state, sent on join, on resume and on resync. It replaces what the client had. */
  "room:snapshot": (payload: RoomSnapshotPayload) => void;
  "chat:history": (payload: ChatHistoryPayload) => void;

  // Updates to shared room state. Each carries the next room version.
  "room:userJoined": (payload: UserJoinedPayload) => void;
  "room:userLeft": (payload: UserLeftPayload) => void;
  "room:presence": (payload: PresencePayload) => void;
  "room:ownerChanged": (payload: OwnerChangedPayload) => void;
  "room:settingsChanged": (payload: RoomSettingsChangedPayload) => void;
  "duck:moved": (payload: DuckMovedPayload) => void;
  "duck:stateChanged": (payload: DuckStateChangedPayload) => void;
  "duck:item": (payload: UsersDelta<{ userId: string; heldItem: HeldItemId }>) => void;
  "duck:appearance": (payload: UsersDelta<{ userId: string; appearance: DuckAppearance }>) => void;
  "chat:message": (payload: ChatMessagePayload) => void;
  "sticker:sent": (payload: StickerSentPayload) => void;
  "sticker:match": (payload: StickerMatchPayload) => void;
  "music:state": (payload: MusicStatePayload) => void;
  "music:permissions": (payload: MusicPermissionsPayload) => void;
  "voice:state": (payload: VoiceStatePayload) => void;
  "krathong:spawned": (payload: KrathongSpawnedPayload) => void;
  "krathong:removed": (payload: KrathongRemovedPayload) => void;

  // The seasonal event is the same for every room and has its own version.
  "event:state": (snapshot: EventSnapshot) => void;
  "event:started": (snapshot: EventSnapshot) => void;
  "event:updated": (snapshot: EventSnapshot) => void;
  "event:ended": (snapshot: EventSnapshot) => void;

  // Sent to one user only; these are not part of the room's shared state.
  "cosmetic:inventory": (payload: { wearableIds: string[] }) => void;
  /** Sent only to the room owner: this member is asking to become a DJ. */
  "music:djRequest": (payload: { userId: string }) => void;
  /** Connection details from one other duck in the voice chat, for you only. */
  "voice:signal": (payload: { from: string; signal: VoiceSignal }) => void;
  "socket:error": (payload: SocketErrorPayload) => void;
}

/** The server events that change shared room state, and so carry a room version. */
export type DeltaEvent = { [E in keyof ServerToClientEvents]: Parameters<ServerToClientEvents[E]>[0] extends { roomVersion: number } ? E : never }[keyof ServerToClientEvents];
/** What the server adds to an update when it publishes it. */
export type VersionFields = "roomVersion" | "serverTime" | "usersVersion" | "interactionVersion" | "krathongVersion";
