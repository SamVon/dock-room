// Everything a browser may send. A payload says what the user wants; it never says who the
// user is or what role they have. The server reads that from the session and the room.
import type { z } from "zod";
import type { EquipSchema, UnequipSchema } from "../cosmetics";
import type { PickupSchema, ReleaseSchema } from "../interactions";
import type {
  CommandSchema,
  DJSchema,
  ItemSchema,
  JoinSchema,
  MessageSchema,
  MoveSchema,
  MusicModeSchema,
  RemoveTrackSchema,
  ResumeSchema,
  ResyncSchema,
  RoomCreateSchema,
  SceneSchema,
  StationSchema,
} from "../protocol";
import type { StickerSchema } from "../stickers";
import type { VoiceJoinResult, VoiceMuteSchema, VoiceSignalSchema } from "../voice";
import type { Ack, ChatSendResult, DuckMoveResult, KrathongReleaseResult, RoomCreateResult } from "./acknowledgements";

type In<S extends z.ZodType> = z.input<S>;

export type RoomCreatePayload = In<typeof RoomCreateSchema>;
export type RoomJoinPayload = In<typeof JoinSchema>;
export type RoomLeavePayload = In<typeof CommandSchema>;
export type RoomResumePayload = In<typeof ResumeSchema>;
export type RoomResyncPayload = In<typeof ResyncSchema>;
export type DuckMovePayload = In<typeof MoveSchema>;
export type ChatSendPayload = In<typeof MessageSchema>;
export type StickerSendPayload = In<typeof StickerSchema>;
export type MusicCommandPayload = In<typeof CommandSchema>;
export type MusicStationPayload = In<typeof StationSchema>;
export type SetMusicModePayload = In<typeof MusicModeSchema>;
export type MusicDJPayload = In<typeof DJSchema>;
export type KrathongPickupPayload = In<typeof PickupSchema>;
export type KrathongReleasePayload = In<typeof ReleaseSchema>;

export interface ClientToServerEvents {
  // Room lifecycle
  "room:create": (payload: RoomCreatePayload, ack: Ack<RoomCreateResult>) => void;
  "room:join": (payload: RoomJoinPayload, ack: Ack) => void;
  "room:leave": (payload: RoomLeavePayload, ack?: Ack) => void;
  /** After a reconnect: "I was in this room". Answered with room:snapshot. */
  "room:resume": (payload: RoomResumePayload, ack: Ack) => void;
  /** "I may have missed something". Answered with room:snapshot. */
  "room:resync": (payload: RoomResyncPayload, ack?: Ack) => void;

  // The sender's own duck
  "duck:move": (payload: DuckMovePayload, ack?: Ack<DuckMoveResult>) => void;
  "chat:message": (payload: ChatSendPayload, ack?: Ack<ChatSendResult>) => void;
  "sticker:send": (payload: StickerSendPayload, ack?: Ack) => void;
  "krathong:pickup": (payload: KrathongPickupPayload, ack?: Ack) => void;
  "krathong:release": (payload: KrathongReleasePayload, ack?: Ack<KrathongReleaseResult>) => void;

  // Shared radio
  "music:play": (payload: MusicCommandPayload, ack?: Ack) => void;
  "music:pause": (payload: MusicCommandPayload, ack?: Ack) => void;
  "music:next": (payload: MusicCommandPayload, ack?: Ack) => void;
  "music:station": (payload: MusicStationPayload, ack?: Ack) => void;
  "music:permission:setMode": (payload: SetMusicModePayload, ack?: Ack) => void;
  "music:permission:addDJ": (payload: MusicDJPayload, ack?: Ack) => void;
  "music:permission:removeDJ": (payload: MusicDJPayload, ack?: Ack) => void;

  // Voice chat. The sound goes browser to browser; these only say who is in it and help them connect.
  "voice:join": (payload: In<typeof VoiceMuteSchema>, ack: Ack<VoiceJoinResult>) => void;
  "voice:leave": (ack?: Ack) => void;
  "voice:mute": (payload: In<typeof VoiceMuteSchema>, ack?: Ack) => void;
  /** Connection details for one other duck in the voice chat. Passed on to that duck only. */
  "voice:signal": (payload: In<typeof VoiceSignalSchema>, ack?: Ack) => void;

  // Duck Room features outside the core list
  "duck:item": (payload: In<typeof ItemSchema>, ack?: Ack) => void;
  "cosmetic:equip": (payload: In<typeof EquipSchema>, ack?: Ack) => void;
  "cosmetic:unequip": (payload: In<typeof UnequipSchema>, ack?: Ack) => void;
  "room:scene": (payload: In<typeof SceneSchema>, ack?: Ack) => void;
  "music:removeTrack": (payload: In<typeof RemoveTrackSchema>, ack?: Ack) => void;
  "music:requestDJ": (ack?: Ack) => void;
}

/** Every event name the server accepts. Anything else is rejected before it reaches a handler. */
export const CLIENT_EVENTS = [
  "room:create",
  "room:join",
  "room:leave",
  "room:resume",
  "room:resync",
  "duck:move",
  "chat:message",
  "sticker:send",
  "krathong:pickup",
  "krathong:release",
  "music:play",
  "music:pause",
  "music:next",
  "music:station",
  "music:permission:setMode",
  "music:permission:addDJ",
  "music:permission:removeDJ",
  "voice:join",
  "voice:leave",
  "voice:mute",
  "voice:signal",
  "duck:item",
  "cosmetic:equip",
  "cosmetic:unequip",
  "room:scene",
  "music:removeTrack",
  "music:requestDJ",
] as const satisfies readonly (keyof ClientToServerEvents)[];
