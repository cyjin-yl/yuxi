import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const SESSION_TTL = 30 * 24 * 3600_000;
export const MEMBER_TTL = 120_000;
export const ROOM_TTL = 24 * 3600_000;

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export class Store {
  constructor({ path, now = Date.now }) {
    this.now = now;
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) throw new Error('unsupported_database_version');
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA secure_delete = ON;
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
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    `);
    if (version < 2) {
      this.transaction(() => {
        this.db.exec('DROP TABLE IF EXISTS qr_keys');
        if (this.db.prepare('PRAGMA table_info(sessions)').all().some((column) => column.name === 'cookie')) {
          this.db.exec('UPDATE sessions SET cookie = NULL; ALTER TABLE sessions DROP COLUMN cookie');
        }
        this.db.exec('PRAGMA user_version = 2');
      });
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }
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
    const row = { hash: tokenHash(token), actor_id: null, expires_at: this.now() + SESSION_TTL };
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
      this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    });
  }

  close() {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
  }
}
