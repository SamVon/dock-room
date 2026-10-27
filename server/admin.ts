// The admin cookie for /admin/events. Accounts and passwords are in server/adminStore.ts.
// Signing in sets a short-lived signed cookie; the password itself is never stored in the browser.
import { createHmac, timingSafeEqual } from "node:crypto";

const ADMIN_COOKIE = "duck_admin";
const HOURS = 8;

const sign = (value: string, secret: string) => createHmac("sha256", `${secret}:admin`).update(value).digest("base64url");

export function adminCookie(secret: string, secure: boolean) {
  const expires = String(Date.now() + HOURS * 3_600_000);
  return [`${ADMIN_COOKIE}=${expires}.${sign(expires, secret)}`, "HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${HOURS * 3600}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export const clearAdminCookie = () => `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

export function isAdmin(cookieHeader: string | undefined, secret: string) {
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_COOKIE}=`))
    ?.slice(ADMIN_COOKIE.length + 1);
  if (!raw) return false;
  const [expires, signature = ""] = raw.split(".");
  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(expires, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) && Number(expires) > Date.now();
}
