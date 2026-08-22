/**
 * Durable Object for listen-together party rooms.
 * Single-threaded per room code → no concurrent-write races.
 * State lives in memory; persisted to DO storage on mutation for crash recovery.
 */

export interface PartyMember { id: string; name: string; joinedAt: number; lastSeen: number }
export interface PartyChat { id: string; name: string; text: string; at: number }
export interface PartyTrack { id: string; title: string; artist: string; coverUrl?: string; duration?: number }
export interface PartyRoomState {
  mode: "idle" | "playing";
  track: PartyTrack | null;
  startedAt: number;
  offset: number;
  serverAt: number;
  hostAt: number;
}
export interface PartyRoom {
  code: string;
  name: string;
  hostId: string;
  createdAt: number;
  updatedAt: number;
  state: PartyRoomState;
  queue: PartyTrack[];
  queueAt: number;
  members: PartyMember[];
  chat: PartyChat[];
}

const MEMBER_TIMEOUT = 120_000;
const CHAT_LIMIT = 100;
const QUEUE_LIMIT = 500;

function prune(room: PartyRoom): PartyRoom {
  const now = Date.now();
  room.members = room.members.filter((m) => now - m.lastSeen < MEMBER_TIMEOUT);
  room.chat = room.chat.slice(-CHAT_LIMIT);
  return room;
}

export class PartyRoomDO implements DurableObject {
  private room: PartyRoom | null = null;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private state: DurableObjectState, private env: { PARTY_INDEX?: DurableObjectNamespace }) {}

  private tableReady = false;

  private async ensureTable(): Promise<void> {
    if (this.tableReady) return;
    this.state.storage.sql.exec("CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
    this.tableReady = true;
  }

  private async ensure(): Promise<PartyRoom | null> {
    if (this.room) return this.room;
    await this.ensureTable();
    const cursor = this.state.storage.sql.exec("SELECT data FROM room WHERE id = 1");
    // NOTE: SqlStorageCursor.one() THROWS when the query returns zero rows
    // ("Expected exactly one result...") — it is not nullable. An empty room
    // table (fresh DO, or after the cleanup alarm's DELETE) must yield null
    // here so callers return room_not_found instead of a 500.
    const rows = cursor.toArray() as { data: string }[];
    const row = rows[0] ?? null;
    if (row) { this.room = JSON.parse(row.data) as PartyRoom; return this.room; }
    return null;
  }

  private markDirty(): void {
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 500);
    }
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (!this.dirty || !this.room) return;
    this.dirty = false;
    await this.ensureTable();
    this.state.storage.sql.exec("INSERT OR REPLACE INTO room (id, data) VALUES (1, ?)", [JSON.stringify(this.room)]);
  }

  private scheduleCleanup(): void {
    // Auto-delete the DO storage after 24h of inactivity via alarm.
    void this.state.storage.setAlarm(Date.now() + 24 * 3600 * 1000);
  }

  /**
   * Reconcile the discovery index with the room's current visible state.
   *
   * The index row is only refreshed on join/leave by design (see the proxy
   * comment near handleParty). A guest who closes the tab without sending
   * /leave therefore leaves their stale seat in the index for up to
   * ROW_TTL_MS (6h) — while /get already prunes them after MEMBER_TIMEOUT
   * (120s). Discovery then misleads: "1 人" but the room is actually empty.
   *
   * This helper closes that drift lazily: when a fetch handler sees a
   * different *pruned* member count than what the room last advertised to
   * the index, fire-and-forget an upsert (or a remove at 0). One DO→DO call
   * per actual change, never per heartbeat.
   */
  private lastIndexedCount: number | null = null;
  private syncIndex(prunedCount: number): void {
    if (!this.room) return;
    if (this.lastIndexedCount === prunedCount) return;
    const code = this.room.code;
    const name = this.room.name;
    const hostId = this.room.hostId;
    const ns = this.env.PARTY_INDEX;
    if (!ns) return;
    this.lastIndexedCount = prunedCount;
    void (async () => {
      try {
        const idx = ns.get(ns.idFromName("INDEX"));
        if (prunedCount > 0) {
          await idx.fetch(new Request("https://idx/upsert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, name, hostId, members: prunedCount, updatedAt: Date.now() }),
          }));
        } else {
          await idx.fetch(new Request(`https://idx/remove?code=${encodeURIComponent(code)}`, { method: "POST" }));
        }
      } catch { /* drift bounded by TTL; safe to ignore */ }
    })();
  }

  /** Drop the room's state if no members remain (or force=true). Returns true if removed. */
  async deleteIfEmpty(force = false): Promise<boolean> {
    if (!this.room) return false;
    const now = Date.now();
    const alive = force ? [] : this.room.members.filter((m) => now - m.lastSeen < MEMBER_TIMEOUT);
    if (alive.length) return false;
    const code = this.room.code;
    this.room = null;
    await this.ensureTable();
    this.state.storage.sql.exec("DELETE FROM room");
    try {
      const ns = this.env.PARTY_INDEX;
      if (ns) await ns.get(ns.idFromName("INDEX")).fetch(new Request(`https://idx/remove?code=${code}`));
    } catch { /* index stale is acceptable */ }
    return true;
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    const removed = await this.deleteIfEmpty();
    if (!removed) this.scheduleCleanup();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1); // everything after leading /

    if (action === "get") {
      const room = await this.ensure();
      if (!room) return json({ error: "room_not_found" }, 404);
      const pruned = prune({ ...room });
      // Read path doubles as the drift detector: a poll arriving after the
      // 120s member timeout is the first signal that someone vanished.
      this.syncIndex(pruned.members.length);
      return json(pruned);
    }

    // Test/maintenance hook: run the same cleanup the alarm would, on demand.
    if (action === "__deleteIfEmpty") {
      await this.ensure();
      const force = url.searchParams.get("force") === "true";
      return json({ removed: await this.deleteIfEmpty(force) });
    }

    const body: Record<string, unknown> =
      request.method === "POST" ? await request.json<Record<string, unknown>>() : {};
    const actorId = typeof body.id === "string" ? body.id : "";
    const actorName = (typeof body.name === "string" ? body.name : "").slice(0, 40) || "听众";

    if (action === "create") {
      if (!actorId) return json({ error: "missing_id" }, 400);
      const now = Date.now();
      const code = url.searchParams.get("code") || "";
      const roomName = (typeof body.roomName === "string" ? body.roomName : "一起听").trim().slice(0, 60) || "一起听";
      const track = readTrack(body);
      const playing = body.playing === true && Boolean(track);
      const offset = typeof body.offset === "number" && Number.isFinite(body.offset) ? Math.max(0, body.offset) : 0;
      const queue = (Array.isArray(body.queue) ? body.queue : [])
        .slice(0, QUEUE_LIMIT)
        .map((item) => readTrackVal(item))
        .filter((t): t is PartyTrack => Boolean(t && t.id !== track?.id));

      this.room = {
        code,
        name: roomName,
        hostId: actorId,
        createdAt: now,
        updatedAt: now,
        state: track
          ? { mode: playing ? "playing" : "idle", track, startedAt: playing ? now : 0, offset, serverAt: now, hostAt: typeof body.hostAt === "number" ? body.hostAt : now }
          : { mode: "idle", track: null, startedAt: 0, offset: 0, serverAt: now, hostAt: now },
        queue,
        queueAt: now,
        members: [{ id: actorId, name: actorName, joinedAt: now, lastSeen: now }],
        chat: [],
      };
      this.markDirty();
      this.scheduleCleanup();
      return json(this.room);
    }

    const room = await this.ensure();
    if (!room) return json({ error: "room_not_found" }, 404);
    if (!actorId) return json({ error: "missing_id" }, 400);

    const now = Date.now();

    // Touch presence
    const touch = () => {
      const existing = room.members.find((m) => m.id === actorId);
      const member: PartyMember = existing
        ? { ...existing, name: actorName || existing.name, lastSeen: now }
        : { id: actorId, name: actorName, joinedAt: now, lastSeen: now };
      room.members = [...room.members.filter((m) => m.id !== actorId), member];
    };

    if (action === "join") {
      touch();
      const message: PartyChat = { id: crypto.randomUUID(), name: actorName, text: "加入了房间", at: now };
      room.chat.push(message);
      room.updatedAt = now;
      this.markDirty();
      this.syncIndex(room.members.length);
      return json(prune(room));
    }

    if (action === "leave") {
      room.members = room.members.filter((m) => m.id !== actorId);
      room.updatedAt = now;
      this.markDirty();
      if (!room.members.length) {
        // Room empty: schedule immediate cleanup
        void this.state.storage.setAlarm(now + 60_000);
      }
      // Leave is authoritative (explicit goodbye, not a timeout prune) —
      // reset the cache so the sync below always fires.
      this.lastIndexedCount = null;
      this.syncIndex(room.members.length);
      return json(prune(room));
    }

    if (action === "heartbeat") {
      touch();
      room.updatedAt = now;
      this.markDirty();
      this.syncIndex(room.members.length);
      return json(prune(room));
    }
    if (action === "play") {
      const track = readTrack(body);
      if (!track) return json({ error: "missing_track" }, 400);
      touch();
      room.state = {
        mode: "playing",
        track,
        startedAt: now,
        offset: typeof body.offset === "number" && Number.isFinite(body.offset) ? Math.max(0, body.offset) : 0,
        serverAt: now,
        hostAt: typeof body.hostAt === "number" ? body.hostAt : now,
      };
      room.updatedAt = now;
      this.markDirty();
      return json(prune(room));
    }

    if (action === "pause") {
      touch();
      const offset = typeof body.offset === "number" && Number.isFinite(body.offset)
        ? Math.max(0, body.offset)
        : room.state.mode === "playing"
          ? room.state.offset + Math.max(0, (now - (room.state.serverAt || now)) / 1000)
          : room.state.offset;
      room.state = { ...room.state, mode: "idle", startedAt: 0, offset, serverAt: now, hostAt: typeof body.hostAt === "number" ? body.hostAt : now };
      room.updatedAt = now;
      this.markDirty();
      return json(prune(room));
    }

    if (action === "queue") {
      const track = readTrack(body);
      if (!track) return json({ error: "missing_track" }, 400);
      touch();
      if (!room.queue.some((item) => item.id === track.id)) room.queue.push(track);
      room.queueAt = now;
      room.updatedAt = now;
      this.markDirty();
      return json(prune(room));
    }

    if (action === "reorder") {
      const order = Array.isArray(body.order) ? body.order.filter((v): v is string => typeof v === "string") : [];
      if (!order.length) return json({ error: "missing_order" }, 400);
      touch();
      const byId = new Map(room.queue.map((t) => [t.id, t]));
      const reordered: PartyTrack[] = [];
      for (const id of order) {
        const t = byId.get(id);
        if (t) { reordered.push(t); byId.delete(id); }
      }
      for (const t of byId.values()) reordered.push(t);
      room.queue = reordered;
      room.queueAt = now;
      room.updatedAt = now;
      this.markDirty();
      return json(prune(room));
    }

    if (action === "chat") {
      const text = (typeof body.text === "string" ? body.text : "").trim().slice(0, 500);
      if (!text) return json({ error: "empty_message" }, 400);
      touch();
      const message: PartyChat = { id: crypto.randomUUID(), name: actorName, text, at: now };
      room.chat.push(message);
      room.updatedAt = now;
      this.markDirty();
      return json(prune(room));
    }

    return json({ error: "unknown_action" }, 400);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function readTrack(body: Record<string, unknown>): PartyTrack | null {
  return readTrackVal(body.track);
}

function readTrackVal(v: unknown): PartyTrack | null {
  const r = asRecord(v);
  if (!r) return null;
  const id = typeof r.id === "string" ? r.id : "";
  const title = typeof r.title === "string" ? r.title : "";
  const artist = typeof r.artist === "string" ? r.artist : "";
  if (!id || !title) return null;
  const coverUrl = typeof r.coverUrl === "string" ? r.coverUrl : undefined;
  const duration = typeof r.duration === "number" ? r.duration : undefined;
  return { id, title, artist, ...(coverUrl ? { coverUrl } : {}), ...(duration ? { duration } : {}) };
}
// Default fetch handler — the DO is accessed via binding, not direct HTTP.
export default {
  fetch(): Response {
    return new Response("yvxi-party-room DO worker", { status: 200 });
  },
};
