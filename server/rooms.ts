import { randomInt, randomUUID } from "node:crypto";
import { LIMITS, ROOM_CODE_ALPHABET, type ChatMessage, type MusicState, type RoomMusicSettings, type RoomUser, type SceneId } from "../shared/protocol";
import type { FloatingKrathong } from "../shared/interactions";
import type { StickerId } from "../shared/stickers";
import type { Config } from "./config";
import type { Logger } from "./logger";

export const MAX_MESSAGES = 100;

/** A user inside a room. `socketId` is only the current connection, never the identity. */
export type Member = RoomUser & {
  socketId: string;
  /** Server time when the duck reaches the place it is walking to. Until then it is still on its way. */
  arrivesAt?: number;
  /** Removes the member for good if they do not reconnect in time. */
  leaveTimer?: NodeJS.Timeout;
};

export type Room = {
  id: string; // internal id, safe to log
  /** Counts every change to shared state. Each update sent to the room carries the next number. */
  version: number;
  /** Parts of the room that also keep their own count. */
  usersVersion: number;
  interactionVersion: number;
  krathongVersion: number;
  code: string; // the secret that lets people in
  ownerUserId: string;
  users: Map<string, Member>; // by userId
  messages: ChatMessage[];
  music: MusicState;
  /** Who may control the radio. DJs are remembered by user id, so they keep the role if they reconnect. */
  musicSettings: RoomMusicSettings;
  /** When a member other than the owner last changed the music (for the shared cooldown). */
  lastSharedMusicChange: number;
  scene: SceneId;
  uploads: Set<string>;
  /** Stickers sent a moment ago and not yet matched: at most one per user. */
  recentStickers: { userId: string; stickerId: StickerId; sentAt: number }[];
  /** userId -> until when that duck is busy in a shared animation */
  interactionLockedUntil: Map<string, number>;
  /** "userA|userB" -> until when that pair cannot match again */
  pairCooldownUntil: Map<string, number>;
  /** Krathongs on the river. Clients work out where each one is; the server only keeps the list. */
  krathongs: FloatingKrathong[];
  /** userId -> when that duck may float its next krathong */
  krathongCooldownUntil: Map<string, number>;
  /** Ducks in the voice chat, by userId. Only the list lives here; the sound never reaches the server. */
  voice: Map<string, { muted: boolean }>;

  createdAt: number;
  cleanupTimer?: NodeJS.Timeout;
  ownerTimer?: NodeJS.Timeout;
};

/** Where rooms live. Swap this for Redis or a database later without touching the socket handlers. */
export interface RoomRepository {
  get(code: string): Room | undefined;
  has(code: string): boolean;
  save(room: Room): void;
  delete(code: string): void;
  count(): number;
  all(): Room[];
}

export class MemoryRoomRepository implements RoomRepository {
  private rooms = new Map<string, Room>();
  get = (code: string) => this.rooms.get(code);
  has = (code: string) => this.rooms.has(code);
  save = (room: Room) => void this.rooms.set(room.code, room);
  delete = (code: string) => void this.rooms.delete(code);
  count = () => this.rooms.size;
  all = () => [...this.rooms.values()];
}

/** Room codes come from the operating system's secure random source, never Math.random(). */
export function generateRoomCode() {
  return Array.from({ length: LIMITS.roomCode }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join("");
}

export class RoomService {
  constructor(
    private readonly repo: RoomRepository,
    private readonly config: Config,
    private readonly log: Logger,
    /** Called when a room is deleted, so its uploaded files can be removed. */
    private readonly onDelete: (room: Room) => void = () => {},
  ) {}

  find = (code: string | undefined) => (code ? this.repo.get(code) : undefined);
  all = () => this.repo.all();

  /** Creates a room owned by `ownerUserId`. Returns null when the server is full. */
  create(ownerUserId: string): Room | null {
    if (this.repo.count() >= this.config.maxRooms) return null;
    let code = generateRoomCode();
    while (this.repo.has(code)) code = generateRoomCode();

    const now = Date.now();
    const room: Room = {
      id: randomUUID(),
      version: 1,
      usersVersion: 0,
      interactionVersion: 0,
      krathongVersion: 0,
      code,
      ownerUserId,
      users: new Map(),
      messages: [],
      music: { stationId: this.config.stations[0].id, playing: false, changedAt: now, changedByUserId: "", version: 1, tracks: [] },
      musicSettings: { controlMode: "OWNER_ONLY", djUserIds: [] },
      lastSharedMusicChange: 0,
      scene: this.config.defaultScene,
      uploads: new Set(),
      recentStickers: [],
      interactionLockedUntil: new Map(),
      pairCooldownUntil: new Map(),
      krathongs: [],
      krathongCooldownUntil: new Map(),
      voice: new Map(),
      createdAt: now,
    };
    this.repo.save(room);
    this.scheduleCleanup(room); // removed again if nobody ever joins
    this.log("ROOM_CREATED", { roomId: room.id, userId: ownerUserId, result: "ok" });
    return room;
  }

  addMessage(room: Room, message: ChatMessage) {
    room.messages.push(message);
    if (room.messages.length > MAX_MESSAGES) room.messages.shift();
  }

  /** Deletes the room after the TTL unless someone joins first. */
  scheduleCleanup(room: Room) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      // Someone is connected again: keep the room.
      if ([...room.users.values()].some((member) => member.connected)) return;
      clearTimeout(room.ownerTimer);
      for (const member of room.users.values()) clearTimeout(member.leaveTimer);
      this.repo.delete(room.code);
      this.onDelete(room);
      this.log("ROOM_DELETED", { roomId: room.id, result: "expired" });
    }, this.config.emptyRoomTtlMs);
    room.cleanupTimer.unref();
  }

  cancelCleanup(room: Room) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
  }
}
