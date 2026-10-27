// The rules a client uses to decide what to do with an update from the server.
// They are small and pure, so the same rules can be tested without a browser.

export type VersionVerdict = "apply" | "ignore" | "gap";

/**
 * Every shared change in a room has the next room version. Given the last version this client
 * applied and the version of an update that just arrived:
 *   - the next number: apply it
 *   - the same or older: ignore it (a duplicate, or something that arrived late)
 *   - a jump: something was missed, so ask the server for a fresh snapshot
 * Before the first snapshot there is nothing to compare with, so updates are ignored.
 */
export function classifyVersion(lastApplied: number | null, incoming: number): VersionVerdict {
  if (lastApplied === null || incoming <= lastApplied) return "ignore";
  return incoming === lastApplied + 1 ? "apply" : "gap";
}

/** For state with its own version (music, the active event): keep whichever is newer. */
export const newer = <T extends { version: number }>(current: T, next: T): T => (next.version > current.version ? next : current);

/** The difference between the server's clock and this device's, from a message that carries server time. */
export const clockOffset = (serverTime: number, localNow = Date.now()) => serverTime - localNow;

/**
 * A new id for a command. `crypto.randomUUID` exists only on secure pages (https or localhost),
 * so on a plain http address in the local network the id is built from random bytes instead.
 */
export function newCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * How long a duck takes to walk from one place to another. The server uses it to know when a duck
 * has arrived, and the browser uses it for the walk on screen, so the two always agree.
 * (Up and down counts half: the floor is drawn at an angle.)
 */
export const walkDurationMs = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  Math.round(Math.max(350, Math.hypot(to.x - from.x, (to.y - from.y) * 0.5) * 3500));
