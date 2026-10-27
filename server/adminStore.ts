// Admin accounts. They live in a small SQLite database file (DATA_DIR/duck-room.db), not in .env.
// A password is never stored: only a salted scrypt hash of it, which cannot be turned back into
// the password. Accounts are made on the server with `npm run admin`, never over the network.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const ADMIN_PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;
const USERNAME = /^[a-z0-9_-]{3,32}$/;
const KEY_BYTES = 64;

export type AdminAccount = { username: string; createdAt: number; updatedAt: number };

export interface AdminStore {
  /** How many admin accounts exist. With none, the admin page is switched off. */
  count(): number;
  list(): AdminAccount[];
  /** Creates the account, or replaces its password. Throws with a readable message if either is not acceptable. */
  setPassword(username: string, password: string): AdminAccount;
  remove(username: string): boolean;
  verify(username: string, password: string): boolean;
}

export const normalizeUsername = (username: string) => username.trim().toLowerCase();

function checkCredentials(username: string, password: string) {
  if (!USERNAME.test(username)) throw new Error("The name must be 3 to 32 characters: letters, digits, - or _");
  if (password.length < ADMIN_PASSWORD_MIN) throw new Error(`The password must be at least ${ADMIN_PASSWORD_MIN} characters`);
  if (password.length > PASSWORD_MAX) throw new Error("The password is too long");
}

/** "scrypt$<salt>$<hash>", both base64url. The salt is random per password, so equal passwords give different hashes. */
export function hashPassword(password: string, salt = randomBytes(16)) {
  return `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, KEY_BYTES).toString("base64url")}`;
}

export function passwordMatches(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  if (expected.length !== KEY_BYTES) return false;
  return timingSafeEqual(scryptSync(password.slice(0, PASSWORD_MAX), Buffer.from(salt, "base64url"), KEY_BYTES), expected);
}

/** Checked when the name is unknown, so a wrong name takes as long as a wrong password. */
const DECOY = hashPassword(randomBytes(16).toString("hex"));

abstract class BaseAdminStore implements AdminStore {
  protected abstract hashOf(username: string): string | undefined;
  protected abstract save(username: string, hash: string, now: number): AdminAccount;
  abstract count(): number;
  abstract list(): AdminAccount[];
  abstract remove(username: string): boolean;

  setPassword(username: string, password: string) {
    const name = normalizeUsername(username);
    checkCredentials(name, password);
    return this.save(name, hashPassword(password), Date.now());
  }

  verify(username: string, password: string) {
    const stored = this.hashOf(normalizeUsername(username));
    const matches = passwordMatches(password, stored ?? DECOY);
    return !!stored && matches;
  }
}

export class SqliteAdminStore extends BaseAdminStore {
  private db: DatabaseSync;

  constructor(file: string) {
    super();
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS admins (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    // Only the user who runs the server may read the file.
    chmodSync(file, 0o600);
  }

  // Every value goes in as a parameter (?), never as part of the SQL text.
  protected hashOf(username: string) {
    const row = this.db.prepare("SELECT password_hash FROM admins WHERE username = ?").get(username) as { password_hash: string } | undefined;
    return row?.password_hash;
  }

  protected save(username: string, hash: string, now: number) {
    this.db
      .prepare("INSERT INTO admins (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at")
      .run(username, hash, now, now);
    return this.list().find((account) => account.username === username)!;
  }

  count() {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM admins").get() as { n: number }).n;
  }

  list() {
    return (this.db.prepare("SELECT username, created_at, updated_at FROM admins ORDER BY username").all() as { username: string; created_at: number; updated_at: number }[]).map(
      (row) => ({ username: row.username, createdAt: row.created_at, updatedAt: row.updated_at }),
    );
  }

  remove(username: string) {
    return this.db.prepare("DELETE FROM admins WHERE username = ?").run(normalizeUsername(username)).changes > 0;
  }

  close() {
    this.db.close();
  }
}

/** For tests, and for a server started without a database: no accounts unless some are added. */
export class MemoryAdminStore extends BaseAdminStore {
  private accounts = new Map<string, AdminAccount & { hash: string }>();

  protected hashOf(username: string) {
    return this.accounts.get(username)?.hash;
  }

  protected save(username: string, hash: string, now: number) {
    const account = { username, hash, createdAt: this.accounts.get(username)?.createdAt ?? now, updatedAt: now };
    this.accounts.set(username, account);
    return { username, createdAt: account.createdAt, updatedAt: now };
  }

  count() {
    return this.accounts.size;
  }

  list() {
    return [...this.accounts.values()].map(({ hash: _hash, ...account }) => account).sort((a, b) => a.username.localeCompare(b.username));
  }

  remove(username: string) {
    return this.accounts.delete(normalizeUsername(username));
  }
}

export const adminDatabasePath = (dataDir: string) => path.join(dataDir, "duck-room.db");
