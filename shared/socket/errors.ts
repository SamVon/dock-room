// The one list of error codes, used in acknowledgements and in `socket:error`.

export const SOCKET_ERROR_CODES = [
  "INVALID_PAYLOAD", // the payload failed validation (wrong type, extra field, out of range)
  "UNAUTHENTICATED", // no valid session
  "FORBIDDEN", // a valid member, but not allowed to do this
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "NOT_IN_ROOM", // the command needs a room and this connection is not in one
  "INVALID_STATE", // well formed, but cannot be done right now (busy, nothing to release, unknown station)
  "TOO_FAR", // the duck is not standing where the action happens
  "RATE_LIMITED",
  "EVENT_INACTIVE", // the seasonal event this belongs to is not on
  "OBJECT_NOT_FOUND", // the user, track or object named in the payload does not exist here
  "CONFLICT", // clashes with what already happened (already in a room, replaced by another tab)
  "VERSION_MISMATCH",
  "INTERNAL_ERROR", // details stay in the server log
] as const;
export type SocketErrorCode = (typeof SOCKET_ERROR_CODES)[number];

/** Safe to show to a user: a code and a short message. Never a stack trace, a path or a secret. */
export type SocketError = {
  code: SocketErrorCode;
  message: string;
  /** With RATE_LIMITED: how long to wait before trying again. */
  retryAfterMs?: number;
};

/** An error that does not belong to an acknowledgement (the command had none, or it is about the connection). */
export type SocketErrorPayload = { error: SocketError; event?: string; serverTime: number };
