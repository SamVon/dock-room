// Anonymous sessions. There is no login, but identity still comes from the server:
// a signed, HttpOnly cookie that page scripts cannot read and clients cannot forge.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type AnonymousSession = { userId: string; sessionId: string; createdAt: number };

export const SESSION_COOKIE = "duck_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sign = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("base64url");

export function createSession(): AnonymousSession {
  return { userId: randomUUID(), sessionId: randomUUID(), createdAt: Date.now() };
}

export function sessionCookie(session: AnonymousSession, secret: string, secure: boolean) {
  const value = `${session.userId}.${session.sessionId}.${session.createdAt}`;
  return [
    `${SESSION_COOKIE}=${value}.${sign(value, secret)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Returns the session from a Cookie header, or null when it is missing, expired or tampered with. */
export function readSession(cookieHeader: string | undefined, secret: string): AnonymousSession | null {
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;

  const cut = raw.lastIndexOf(".");
  const value = raw.slice(0, cut);
  const given = Buffer.from(raw.slice(cut + 1));
  const expected = Buffer.from(sign(value, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const [userId, sessionId, created] = value.split(".");
  const createdAt = Number(created);
  if (!UUID.test(userId) || !UUID.test(sessionId) || !Number.isFinite(createdAt)) return null;
  if (Date.now() - createdAt > MAX_AGE_SECONDS * 1000) return null;
  return { userId, sessionId, createdAt };
}
