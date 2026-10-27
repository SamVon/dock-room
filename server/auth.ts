// The one place that decides who may do what. Every socket handler goes through these helpers,
// so future owner actions (kick, mute, room settings) get the same checks for free.
import type { Socket } from "socket.io";
import { canControlMusic, type ClientToServerEvents, type SocketErrorCode, type ServerToClientEvents } from "../shared/protocol";
import type { Member, Room, RoomService } from "./rooms";
import type { AnonymousSession } from "./sessions";

export type SocketData = { session: AnonymousSession; ip: string; roomCode?: string };
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** An error that is safe to show to the client: a code and a short generic message. */
export class AppError extends Error {
  constructor(
    public readonly code: SocketErrorCode,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** The socket's room and its member record. Throws unless this connection is really in a room. */
export function requireRoomMember(socket: AppSocket, rooms: RoomService): { room: Room; member: Member } {
  const room = rooms.find(socket.data.roomCode);
  const member = room?.users.get(socket.data.session.userId);
  // The member must also be on *this* connection: an older tab that was replaced no longer counts.
  if (!room || !member || member.socketId !== socket.id) throw new AppError("NOT_IN_ROOM", "Join a room first");
  return { room, member };
}

/** Like requireRoomMember, and the user must be the owner according to the server's own record. */
export function requireRoomOwner(socket: AppSocket, rooms: RoomService): { room: Room; member: Member } {
  const found = requireRoomMember(socket, rooms);
  if (found.room.ownerUserId !== socket.data.session.userId) throw new AppError("FORBIDDEN", "Only the room owner can do that");
  return found;
}

/** A member who may control the shared radio: the owner, a DJ, or anyone when the room allows it. */
export function requireMusicControl(socket: AppSocket, rooms: RoomService): { room: Room; member: Member } {
  const found = requireRoomMember(socket, rooms);
  if (!canControlMusic(found.room, socket.data.session.userId)) throw new AppError("FORBIDDEN", "You cannot control the radio in this room");
  return found;
}
