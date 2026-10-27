// Calls to the server's HTTP endpoints. The session lives in an HttpOnly cookie,
// so there is nothing to store or send by hand: the browser attaches it.

import type { Equipment } from "@/shared/cosmetics";
import { newCommandId } from "@/shared/sync";
import type { EventSnapshot } from "@/shared/events";
import type { SceneId } from "@/shared/protocol";

/**
 * Makes sure this browser has a server-issued anonymous session. Also returns the season's
 * default scene, the seasonal event that is on, and what this session may wear.
 */
export async function ensureSession(): Promise<{ scene: SceneId; event: EventSnapshot; inventory: string[]; equipment: Equipment }> {
  const res = await fetch("/api/session", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not start a session");
  return res.json();
}

/** Asks the server to create a room. The server picks the code. */
export async function createRoom(): Promise<string> {
  await ensureSession();
  // The custom header cannot be sent by other websites, which blocks cross-site requests.
  // The command id makes a retry safe: the same id never opens a second room.
  const id = newCommandId();
  const res = await fetch("/api/rooms", { method: "POST", headers: { "x-duck-room": "1", "x-command-id": id } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Could not create a room");
  return data.code;
}
