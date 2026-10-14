import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FRIEND_CODE_ALPHABET, FRIEND_CODE_LENGTH, LINK_CODE_LENGTH, MAX_FRIENDS, MAX_PENDING_REQUESTS,
} from '@runrun/shared/community';

const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const NAME_FALLBACK = 'Piloto';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomCode = (len) => {
  let out = '';
  for (const b of crypto.randomBytes(len)) out += FRIEND_CODE_ALPHABET[b % FRIEND_CODE_ALPHABET.length];
  return out;
};
const pair = (a, b) => (a < b ? [a, b] : [b, a]);

/**
 * Persistencia de la comunidad en SQLite (node:sqlite, sin dependencias
 * nativas). Cuentas anónimas por dispositivo: cada navegador guarda un id y un
 * token; del token solo se guarda el hash. Una cuenta puede tener varios
 * dispositivos (ver createLinkCode / redeemLinkCode).
 */
export class CommunityStore {
  constructor(file = ':memory:', { now = Date.now } = {}) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.now = now;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        friend_code TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS device_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS friendships (
        user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_a, user_b)
      );
      CREATE INDEX IF NOT EXISTS friendships_b ON friendships(user_b);
      CREATE TABLE IF NOT EXISTS friend_requests (
        from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id)
      );
      CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests(to_id);
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);
      CREATE TABLE IF NOT EXISTS link_codes (
        code TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  close() {
    this.db.close();
  }

  // ----- Cuentas -----

  createUser(name) {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    const t = this.now();
    let friendCode;
    do friendCode = randomCode(FRIEND_CODE_LENGTH);
    while (this.db.prepare('SELECT 1 FROM users WHERE friend_code = ?').get(friendCode));
    this.db.prepare('INSERT INTO users (id, name, friend_code, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
      .run(id, name || NAME_FALLBACK, friendCode, t, t);
    this.db.prepare('INSERT INTO device_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(sha256(token), id, t);
    return { user: this.getUser(id), token };
  }

  authenticate(userId, token) {
    if (typeof userId !== 'string' || typeof token !== 'string' || token.length > 200) return null;
    const row = this.db.prepare('SELECT user_id FROM device_tokens WHERE token_hash = ?').get(sha256(token));
    if (!row || row.user_id !== userId) return null;
    this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(this.now(), userId);
    return this.getUser(userId);
  }

  getUser(id) {
    const row = this.db.prepare('SELECT id, name, friend_code FROM users WHERE id = ?').get(id);
    return row ? { id: row.id, name: row.name, friendCode: row.friend_code } : null;
  }

  findByFriendCode(code) {
    const row = this.db.prepare('SELECT id FROM users WHERE friend_code = ?').get(code);
    return row ? this.getUser(row.id) : null;
  }

  setName(userId, name) {
    if (name) this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
  }

  /** Código corto de un solo uso para abrir la misma cuenta en otro dispositivo. */
  createLinkCode(userId) {
    const t = this.now();
    this.db.prepare('DELETE FROM link_codes WHERE expires_at < ? OR user_id = ?').run(t, userId);
    let code;
    do code = randomCode(LINK_CODE_LENGTH);
    while (this.db.prepare('SELECT 1 FROM link_codes WHERE code = ?').get(code));
    const expiresAt = t + LINK_CODE_TTL_MS;
    this.db.prepare('INSERT INTO link_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, userId, expiresAt);
    return { code, expiresAt };
  }

  redeemLinkCode(code) {
    const row = this.db.prepare('SELECT user_id, expires_at FROM link_codes WHERE code = ?').get(code);
    if (!row) return null;
    this.db.prepare('DELETE FROM link_codes WHERE code = ?').run(code);
    if (row.expires_at < this.now()) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO device_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(sha256(token), row.user_id, this.now());
    return { user: this.getUser(row.user_id), token };
  }

  // ----- Amistades -----

  areFriends(a, b) {
    const [x, y] = pair(a, b);
    return Boolean(this.db.prepare('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?').get(x, y));
  }

  hasRequest(fromId, toId) {
    return Boolean(this.db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(fromId, toId));
  }

  friendCount(userId) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM friendships WHERE user_a = ? OR user_b = ?').get(userId, userId).n;
  }

  /**
   * Envía una solicitud. Si el otro ya nos la había enviado, se aceptan
   * ambas y queda la amistad hecha.
   * @returns {{error: string} | {status: 'sent' | 'accepted', to: object}}
   */
  sendRequest(fromId, toId) {
    if (fromId === toId) return { error: 'Ese es tu propio código.' };
    const to = this.getUser(toId);
    if (!to) return { error: 'No existe ningún piloto con ese código.' };
    if (this.areFriends(fromId, toId)) return { error: `${to.name} ya es tu amigo.` };
    if (this.hasRequest(toId, fromId)) {
      const res = this.respond(fromId, toId, true);
      return res.error ? res : { status: 'accepted', to };
    }
    if (this.hasRequest(fromId, toId)) return { error: `Ya enviaste una solicitud a ${to.name}.` };
    const pending = this.db.prepare('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ?').get(fromId).n;
    if (pending >= MAX_PENDING_REQUESTS) return { error: 'Tienes demasiadas solicitudes pendientes.' };
    if (this.friendCount(fromId) >= MAX_FRIENDS) return { error: `Ya tienes el máximo de ${MAX_FRIENDS} amigos.` };
    this.db.prepare('INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)').run(fromId, toId, this.now());
    return { status: 'sent', to };
  }

  /** El usuario `userId` acepta o rechaza la solicitud que le envió `fromId`. */
  respond(userId, fromId, accept) {
    if (!this.hasRequest(fromId, userId)) return { error: 'La solicitud ya no existe.' };
    if (accept && (this.friendCount(userId) >= MAX_FRIENDS || this.friendCount(fromId) >= MAX_FRIENDS)) {
      return { error: `Se alcanzó el máximo de ${MAX_FRIENDS} amigos.` };
    }
    this.db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)')
      .run(fromId, userId, userId, fromId);
    if (accept) {
      const [x, y] = pair(userId, fromId);
      this.db.prepare('INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)').run(x, y, this.now());
    }
    return { ok: true };
  }

  cancelRequest(fromId, toId) {
    return this.db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(fromId, toId).changes > 0;
  }

  removeFriend(userId, friendId) {
    const [x, y] = pair(userId, friendId);
    return this.db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(x, y).changes > 0;
  }

  friendIds(userId) {
    return this.db.prepare(`
      SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id
      FROM friendships WHERE user_a = ? OR user_b = ?`).all(userId, userId, userId).map((r) => r.id);
  }

  /** Amigos y solicitudes (sin presencia: eso lo añade la capa de sockets). */
  listFor(userId) {
    const friends = this.db.prepare(`
      SELECT u.id, u.name, u.friend_code, f.created_at FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
      WHERE f.user_a = ? OR f.user_b = ?
      ORDER BY u.name COLLATE NOCASE`).all(userId, userId, userId);
    const incoming = this.db.prepare(`
      SELECT u.id, u.name, u.friend_code, r.created_at FROM friend_requests r JOIN users u ON u.id = r.from_id
      WHERE r.to_id = ? ORDER BY r.created_at DESC`).all(userId);
    const outgoing = this.db.prepare(`
      SELECT u.id, u.name, u.friend_code, r.created_at FROM friend_requests r JOIN users u ON u.id = r.to_id
      WHERE r.from_id = ? ORDER BY r.created_at DESC`).all(userId);
    const shape = (r) => ({ id: r.id, name: r.name, friendCode: r.friend_code, since: r.created_at });
    return { friends: friends.map(shape), incoming: incoming.map(shape), outgoing: outgoing.map(shape) };
  }

  // ----- Notificaciones push -----

  savePushSubscription(userId, { endpoint, keys } = {}) {
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) return false;
    if (typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) return false;
    // Máximo 10 dispositivos por cuenta: se descartan los más antiguos.
    this.db.prepare(`
      DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint NOT IN (
        SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 9)`).run(userId, userId);
    this.db.prepare(`
      INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(endpoint, userId, keys.p256dh, keys.auth, this.now());
    return true;
  }

  removePushSubscription(endpoint, userId) {
    if (userId) this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
    else this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  pushSubscriptionsOf(userId) {
    return this.db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId)
      .map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
  }

  // ----- Varios -----

  getMeta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  }

  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
}
