import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';

const SESSION_TTL = 30 * 24 * 3600_000;
export const MEMBER_TTL = 120_000;
export const ROOM_TTL = 24 * 3600_000;

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function loadKey(file) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const key = readFileSync(file);
  if (key.length !== 32) throw new Error('invalid_session_key');
  return key;
}

export class Store {
  constructor({ path, key, keyFile, now = Date.now }) {
    this.now = now;
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.key = key ? Buffer.from(key) : loadKey(keyFile ?? `${path}.key`);
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('unsupported_database_version');
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA journal_size_limit = 16777216;
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms(expires_at);
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY,
        actor_id TEXT UNIQUE,
        cookie TEXT,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS qr_keys (
        key TEXT PRIMARY KEY,
        session_hash TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    this.sweep();
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  session(token) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.db.prepare('SELECT * FROM sessions WHERE hash = ? AND expires_at > ?').get(tokenHash(token), this.now());
    if (!row) return null;
    if (row.expires_at < this.now() + SESSION_TTL / 2) {
      row.expires_at = this.now() + SESSION_TTL;
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE hash = ?').run(row.expires_at, row.hash);
    }
    return row;
  }

  newSession() {
    const token = randomBytes(32).toString('base64url');
    const row = { hash: tokenHash(token), actor_id: null, cookie: null, expires_at: this.now() + SESSION_TTL };
    this.db.prepare('INSERT INTO sessions(hash, expires_at) VALUES (?, ?)').run(row.hash, row.expires_at);
    return { token, row };
  }

  bindActor(session, actor) {
    if (session.actor_id) return session.actor_id === actor;
    try {
      this.db.prepare('UPDATE sessions SET actor_id = ? WHERE hash = ? AND actor_id IS NULL').run(actor, session.hash);
      session.actor_id = actor;
      return true;
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint/.test(error.message)) return false;
      throw error;
    }
  }

  cookie(session) {
    if (!session?.cookie) return '';
    const [iv, tag, data] = session.cookie.split('.').map((value) => Buffer.from(value, 'base64url'));
    const cipher = createDecipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(session.hash));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString();
  }

  saveCookie(session, cookie) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(session.hash));
    const encrypted = Buffer.concat([cipher.update(cookie), cipher.final()]);
    const value = [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
    this.db.prepare('UPDATE sessions SET cookie = ? WHERE hash = ?').run(value, session.hash);
    session.cookie = value;
  }

  clearCookie(session) {
    this.db.prepare('UPDATE sessions SET cookie = NULL WHERE hash = ?').run(session.hash);
    session.cookie = null;
  }

  getRoom(code) {
    const row = this.db.prepare('SELECT data FROM rooms WHERE code = ? AND expires_at > ?').get(code, this.now());
    return row ? JSON.parse(row.data) : null;
  }

  insertRoom(room) {
    return this.db.prepare('INSERT OR IGNORE INTO rooms(code, data, updated_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(room.code, JSON.stringify(room), room.updatedAt, this.now() + ROOM_TTL).changes > 0;
  }

  saveRoom(room, expires = this.now() + ROOM_TTL) {
    this.db.prepare('UPDATE rooms SET data = ?, updated_at = ?, expires_at = ? WHERE code = ?')
      .run(JSON.stringify(room), room.updatedAt, expires, room.code);
  }

  rooms() {
    return this.db.prepare('SELECT data FROM rooms WHERE expires_at > ? ORDER BY updated_at DESC LIMIT 1000')
      .all(this.now()).map((row) => JSON.parse(row.data));
  }

  sweep() {
    const now = this.now();
    this.transaction(() => {
      this.db.prepare('DELETE FROM rooms WHERE expires_at <= ?').run(now);
      this.db.prepare('DELETE FROM qr_keys WHERE expires_at <= ?').run(now);
      this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    });
  }

  close() {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
    this.key.fill(0);
  }
}
