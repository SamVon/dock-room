// Structured security log: one JSON object per line.
// Never pass cookies, session secrets or room codes here. Rooms are logged by their internal id,
// because the room code is what grants access to a room.

export type LogEvent =
  | "ROOM_CREATED"
  | "ROOM_JOIN"
  | "ROOM_LEAVE"
  | "ROOM_DELETED"
  | "OWNER_CHANGED"
  | "CHAT_RATE_LIMITED"
  | "RATE_LIMITED"
  | "INVALID_SOCKET_EVENT"
  | "COMMAND_REJECTED"
  | "MUSIC_PERMISSION_DENIED"
  | "PERMISSION_DENIED"
  | "SESSION_INVALID"
  | "ORIGIN_REJECTED"
  | "TRACK_UPLOADED"
  | "EVENT_STARTED"
  | "EVENT_UPDATED"
  | "EVENT_ENDED"
  | "EVENT_CONFIG"
  | "ADMIN_LOGIN"
  | "ADMIN_CHANGE"
  | "SERVER_ERROR";

export type LogFields = { roomId?: string; userId?: string; result?: string; detail?: string };
export type Logger = (event: LogEvent, fields?: LogFields) => void;

export const jsonLogger: Logger = (event, fields = {}) => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
};
