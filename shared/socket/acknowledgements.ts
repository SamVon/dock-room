// The one shape every command is answered with.
import type { SocketError } from "./errors";

export type AckSuccess<T = undefined> = { ok: true; commandId?: string; data?: T };
export type AckFailure = { ok: false; commandId?: string; error: SocketError };
/** It says whether the command was accepted. Shared state still arrives as server events. */
export type SocketAck<T = undefined> = AckSuccess<T> | AckFailure;
export type Ack<T = undefined> = (result: SocketAck<T>) => void;

export type RoomCreateResult = { roomId: string; roomCode: string };
export type DuckMoveResult = { serverMoveId: string };
export type ChatSendResult = { messageId: string };
export type KrathongReleaseResult = { krathongId: string; interactionId: string };
