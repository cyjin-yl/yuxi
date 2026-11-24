import { randomInt, randomUUID } from 'node:crypto';
import { MEMBER_TTL } from './storage.mjs';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE = /^[A-Z2-9]{4}$/;
const ACTOR = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_QUEUE = 500;
const MAX_MEMBERS = 64;
const ACTIONS = new Set(['join', 'leave', 'heartbeat', 'play', 'pause', 'queue', 'reorder', 'chat']);

export class HttpError extends Error {
  constructor(status, code, details) { super(code); this.status = status; this.details = details; }
}

export function newRoomCode() {
  return Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

const text = (value, max, fallback = '') => typeof value === 'string' ? value.trim().slice(0, max) || fallback : fallback;
const number = (value, fallback = 0, max = 86400) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;

function track(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = text(value.id, 100);
  const title = text(value.title, 240);
  if (!id || !title) return null;
  const item = { id, title, artist: text(value.artist, 240) };
  if (typeof value.coverUrl === 'string' && value.coverUrl.length <= 2048) {
    try {
      const url = new URL(value.coverUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') item.coverUrl = url.href;
    } catch { /* An invalid optional cover does not invalidate a track. */ }
  }
  if (number(value.duration)) item.duration = number(value.duration);
  return item;
}

function prune(room, now) {
  room.members = room.members.filter((member) => now - member.lastSeen < MEMBER_TTL);
  room.chat = room.chat.slice(-100);
  return room;
}

function touch(room, id, name, now) {
  const current = room.members.find((member) => member.id === id);
  if (!current && room.members.length >= MAX_MEMBERS) throw new HttpError(409, 'room_full');
  room.members = room.members.filter((member) => member.id !== id);
  room.members.push({ id, name: name || current?.name || '听众', joinedAt: current?.joinedAt ?? now, lastSeen: now });
}

export function party({ store, path, method, body, session, codeGenerator = newRoomCode }) {
  const parts = path.split('/').filter(Boolean);
  const now = store.now();
  if (parts.length === 2 && method === 'GET') {
    const rooms = store.rooms().map((room) => prune(room, now)).filter((room) => room.members.length > 0);
    return { rooms: rooms.sort((a, b) => b.members.length - a.members.length || b.updatedAt - a.updatedAt).slice(0, 100).map((room) => ({
      code: room.code, name: room.name, members: room.members.length, host: Boolean(session?.actor_id && room.hostId === session.actor_id),
    })) };
  }
  const create = parts.length === 3 && parts[2] === 'create';
  const code = (parts[2] ?? '').toUpperCase();
  const action = parts[3] ?? 'get';
  if (!create && (!CODE.test(code) || parts.length > 4)) throw new HttpError(400, 'invalid_room_code');
  if (!create && !ACTIONS.has(action) && action !== 'get') throw new HttpError(404, 'not_found');
  if (!create && action === 'get') {
    if (method !== 'GET') throw new HttpError(405, 'method_not_allowed');
    const room = store.getRoom(code);
    if (!room) throw new HttpError(404, 'room_not_found');
    return prune(room, now);
  }
  if (method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const id = body.id;
  if (typeof id !== 'string' || !ACTOR.test(id)) throw new HttpError(400, 'invalid_actor_id');
  if (!session || !store.bindActor(session, id)) throw new HttpError(409, 'actor_identity_conflict', session?.actor_id ? { actorId: session.actor_id } : undefined);
  const name = text(body.name, 40, '听众');
  return store.transaction(() => {
    if (create) {
      if (store.db.prepare('SELECT count(*) AS n FROM rooms').get().n >= 1000) throw new HttpError(503, 'rooms_capacity');
      if (Array.isArray(body.queue) && body.queue.length > MAX_QUEUE) throw new HttpError(413, 'queue_limit');
      const current = track(body.track);
      const queueMap = new Map();
      for (const raw of Array.isArray(body.queue) ? body.queue : []) {
        const item = track(raw);
        if (item && item.id !== current?.id) queueMap.set(item.id, item);
      }
      const playing = body.playing === true && Boolean(current);
      const room = {
        code: '', name: text(body.roomName, 60, '一起听'), hostId: id, createdAt: now, updatedAt: now,
        state: { mode: playing ? 'playing' : 'idle', track: current, startedAt: playing ? now : 0,
          offset: current ? number(body.offset) : 0, serverAt: now, hostAt: now },
        queue: [...queueMap.values()], queueAt: now,
        members: [{ id, name, joinedAt: now, lastSeen: now }], chat: [],
      };
      for (let attempt = 0; attempt < 32; attempt++) {
        room.code = codeGenerator();
        if (!CODE.test(room.code)) throw new Error('invalid_code_generator');
        if (store.insertRoom(room)) return room;
      }
      throw new HttpError(503, 'room_code_exhausted');
    }
    const room = store.getRoom(code);
    if (!room) throw new HttpError(404, 'room_not_found');
    prune(room, now);
    const member = room.members.some((item) => item.id === id);
    if (!member && !['join', 'heartbeat', 'leave'].includes(action)) throw new HttpError(403, 'join_room_first');
    const stamp = Math.max(now, room.updatedAt + 1);
    if (action === 'leave') {
      room.members = room.members.filter((item) => item.id !== id);
    } else {
      touch(room, id, name, now);
      if (action === 'join' && !member) room.chat.push({ id: randomUUID(), name, text: '加入了房间', at: stamp });
      if (action === 'play') {
        const item = track(body.track);
        if (!item) throw new HttpError(400, 'missing_track');
        room.state = { mode: 'playing', track: item, startedAt: now, offset: number(body.offset), serverAt: stamp, hostAt: now };
        // Advancing to a queued track consumes it. An unrelated queued add is retained.
        room.queue = room.queue.filter((queued) => queued.id !== item.id);
        room.queueAt = stamp;
      } else if (action === 'pause') {
        const playbackAt = room.state.hostAt ?? room.state.serverAt;
        const currentOffset = room.state.mode === 'playing' ? room.state.offset + Math.max(0, (now - playbackAt) / 1000) : room.state.offset;
        room.state = { ...room.state, mode: 'idle', startedAt: 0, offset: number(body.offset, currentOffset), serverAt: stamp, hostAt: now };
      } else if (action === 'queue') {
        const item = track(body.track);
        if (!item) throw new HttpError(400, 'missing_track');
        if (!room.queue.some((queued) => queued.id === item.id)) {
          if (room.queue.length >= MAX_QUEUE) throw new HttpError(409, 'queue_limit');
          room.queue.push(item);
        }
        room.queueAt = stamp;
      } else if (action === 'reorder') {
        if (!Array.isArray(body.order) || body.order.length > MAX_QUEUE || body.order.some((item) => typeof item !== 'string')) throw new HttpError(400, 'invalid_order');
        const remaining = new Map(room.queue.map((item) => [item.id, item]));
        const reordered = [];
        for (const itemId of body.order) {
          if (remaining.has(itemId)) { reordered.push(remaining.get(itemId)); remaining.delete(itemId); }
        }
        // Keep additions that arrived after the client's snapshot.
        room.queue = [...reordered, ...remaining.values()].filter((item) => item.id !== room.state.track?.id);
        room.queueAt = stamp;
      } else if (action === 'chat') {
        const message = text(body.text, 500);
        if (!message) throw new HttpError(400, 'empty_message');
        room.chat.push({ id: randomUUID(), name, text: message, at: stamp });
      }
    }
    room.updatedAt = stamp;
    room.chat = room.chat.slice(-100);
    store.saveRoom(room, !room.members.length && action === 'leave' ? now + 60_000 : undefined);
    return room;
  });
}
