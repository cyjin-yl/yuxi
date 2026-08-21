export interface PartyTrack {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
  duration?: number;
}
export interface PartyMember { id: string; name: string; joinedAt: number; lastSeen: number }
export interface PartyChat { id: string; name: string; text: string; at: number }
export interface PartyRoom {
  code: string;
  name: string;
  hostId: string;
  createdAt: number;
  updatedAt: number;
  state: {
    mode: 'idle' | 'playing';
    track: PartyTrack | null;
    startedAt: number;
    offset: number;
    /** Server wall-clock when this state was written (ms). */
    serverAt: number;
    /** Host device wall-clock when this state was written (ms). */
    hostAt: number;
  };
  queue: PartyTrack[];
  /** Server wall-clock when the shared queue was last written. */
  queueAt: number;
  members: PartyMember[];
  chat: PartyChat[];
}

export interface PartyInit {
  track: PartyTrack | null;
  playing: boolean;
  offset: number;
  queue: PartyTrack[];
}

const BASE = '/netease/party';
const NAME_KEY = 'yuxi-party-name';
const ID_KEY = 'yuxi-party-id';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function normalizeRoom(value: unknown): PartyRoom {
  const outer = asRecord(value);
  const raw = asRecord(outer?.room) ?? outer;
  if (!raw || typeof raw.code !== 'string') throw new Error('party_invalid_response');
  const state = asRecord(raw.state);
  const mode = state?.mode === 'playing' ? 'playing' : 'idle';
  return {
    code: raw.code,
    name: typeof raw.name === 'string' ? raw.name : '一起听',
    hostId: typeof raw.hostId === 'string' ? raw.hostId : '',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    state: {
      mode,
      track: asRecord(state?.track) as unknown as PartyTrack | null,
      startedAt: typeof state?.startedAt === 'number' ? state.startedAt : 0,
      offset: typeof state?.offset === 'number' ? state.offset : 0,
      serverAt: typeof state?.serverAt === 'number' ? state.serverAt : 0,
      hostAt: typeof state?.hostAt === 'number' ? state.hostAt : 0,
    },
    queue: Array.isArray(raw.queue) ? raw.queue as PartyTrack[] : [],
    queueAt: typeof raw.queueAt === 'number' ? raw.queueAt : (typeof raw.updatedAt === 'number' ? raw.updatedAt : 0),
    members: Array.isArray(raw.members) ? raw.members as PartyMember[] : [],
    chat: Array.isArray(raw.chat) ? raw.chat as PartyChat[] : [],
  };
}

export function partyId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function partyName(): string {
  return localStorage.getItem(NAME_KEY) || `听众${partyId().slice(0, 6)}`;
}

export function setPartyName(name: string) {
  localStorage.setItem(NAME_KEY, name.slice(0, 40));
}

async function post(path: string, body: Record<string, unknown> = {}): Promise<PartyRoom> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: partyId(), name: partyName(), ...body }),
  });
  if (!res.ok) throw new Error(`party_${res.status}`);
  return normalizeRoom(await res.json());
}
export async function createRoom(name: string, initial?: PartyInit): Promise<PartyRoom> {
  const hostAt = Date.now();
  // Always send a non-empty roomName so the worker never falls back to the
  // member nickname field (`name`) for the room title.
  const room = await post('/create', {
    roomName: (name || '一起听').slice(0, 60),
    track: initial?.track ?? null,
    playing: initial?.playing === true,
    offset: Number.isFinite(initial?.offset) ? Math.max(0, initial?.offset ?? 0) : 0,
    queue: Array.isArray(initial?.queue) ? initial.queue : [],
    hostAt,
  });
  if (!room.code) throw new Error('party_invalid_response');
  return room;
}


export async function joinRoom(code: string): Promise<PartyRoom> {
  return post(`/${code}/join`, {});
}

export async function leaveRoom(code: string): Promise<PartyRoom> {
  return post(`/${code}/leave`, {});
}

export async function heartbeat(code: string): Promise<PartyRoom> {
  return post(`/${code}/heartbeat`, {});
}

export async function sendChat(code: string, text: string): Promise<PartyRoom> {
  return post(`/${code}/chat`, { text });
}

export async function announcePlay(
  code: string,
  track: PartyTrack,
  startedAt: number,
  offset: number,
  hostAt: number = Date.now(),
): Promise<PartyRoom> {
  return post(`/${code}/play`, { track, startedAt, offset, hostAt });
}

export async function announcePause(code: string, offset?: number, hostAt: number = Date.now()): Promise<PartyRoom> {
  return post(`/${code}/pause`, {
    hostAt,
    ...(typeof offset === 'number' && Number.isFinite(offset) ? { offset: Math.max(0, offset) } : {}),
  });
}

export async function enqueueTrack(code: string, track: PartyTrack): Promise<PartyRoom> {
  return post(`/${code}/queue`, { track });
}

export async function fetchRoom(code: string): Promise<PartyRoom> {
  const res = await fetch(`${BASE}/${code}`);
  if (!res.ok) throw new Error(`party_${res.status}`);
  return normalizeRoom(await res.json());
}

export async function listRooms(): Promise<{ code: string; name: string; members: number; host: boolean }[]> {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error(`party_${res.status}`);
  const body = asRecord(await res.json());
  if (!Array.isArray(body?.rooms)) return [];
  return body.rooms.flatMap((value) => {
    const room = asRecord(value);
    if (!room || typeof room.code !== 'string') return [];
    return [{
      code: room.code,
      name: typeof room.name === 'string' ? room.name : '一起听',
      members: typeof room.members === 'number' ? room.members : 0,
      host: room.host === true,
    }];
  });
}

export async function reorderQueue(code: string, order: string[]): Promise<PartyRoom> {
  return post(`/${code}/reorder`, { order });
}

/**
 * Position (seconds) the room is at right now.
 * Prefers hostAt so guests can compensate for network delay:
 * pos = offset + (now - hostAt)/1000 when playing.
 */
export function roomPosition(room: PartyRoom, nowMs: number = Date.now()): number {
  const state = room.state;
  if (!state) return 0;
  const { mode, startedAt, offset, hostAt } = state;
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  if (mode !== 'playing') return safeOffset;
  const anchor = hostAt > 0 ? hostAt : startedAt;
  if (!anchor) return safeOffset;
  return safeOffset + Math.max(0, (nowMs - anchor) / 1000);
}
