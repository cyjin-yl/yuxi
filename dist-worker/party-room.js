var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// workers/party-room.ts
var MEMBER_TIMEOUT = 12e4;
var CHAT_LIMIT = 100;
var QUEUE_LIMIT = 500;
function prune(room) {
  const now = Date.now();
  room.members = room.members.filter((m) => now - m.lastSeen < MEMBER_TIMEOUT);
  room.chat = room.chat.slice(-CHAT_LIMIT);
  return room;
}
__name(prune, "prune");
var PartyRoomDO = class {
  constructor(state, _env) {
    this.state = state;
  }
  state;
  static {
    __name(this, "PartyRoomDO");
  }
  room = null;
  dirty = false;
  flushTimer = null;
  tableReady = false;
  async ensureTable() {
    if (this.tableReady) return;
    this.state.storage.sql.exec("CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
    this.tableReady = true;
  }
  async ensure() {
    if (this.room) return this.room;
    await this.ensureTable();
    const cursor = this.state.storage.sql.exec("SELECT data FROM room WHERE id = 1");
    const rows = cursor.toArray();
    const row = rows[0] ?? null;
    if (row) {
      this.room = JSON.parse(row.data);
      return this.room;
    }
    return null;
  }
  markDirty() {
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 500);
    }
  }
  async flush() {
    this.flushTimer = null;
    if (!this.dirty || !this.room) return;
    this.dirty = false;
    await this.ensureTable();
    this.state.storage.sql.exec("INSERT OR REPLACE INTO room (id, data) VALUES (1, ?)", [JSON.stringify(this.room)]);
  }
  scheduleCleanup() {
    void this.state.storage.setAlarm(Date.now() + 24 * 3600 * 1e3);
  }
  async alarm() {
    if (this.room) {
      const now = Date.now();
      const alive = this.room.members.filter((m) => now - m.lastSeen < MEMBER_TIMEOUT);
      if (!alive.length) {
        this.room = null;
        await this.ensureTable();
        this.state.storage.sql.exec("DELETE FROM room");
      } else {
        this.scheduleCleanup();
      }
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);
    if (action === "get") {
      const room2 = await this.ensure();
      if (!room2) return json({ error: "room_not_found" }, 404);
      return json(prune({ ...room2 }));
    }
    const body = request.method === "POST" ? await request.json() : {};
    const actorId = typeof body.id === "string" ? body.id : "";
    const actorName = (typeof body.name === "string" ? body.name : "").slice(0, 40) || "\u542C\u4F17";
    if (action === "create") {
      if (!actorId) return json({ error: "missing_id" }, 400);
      const now2 = Date.now();
      const code = url.searchParams.get("code") || "";
      const roomName = (typeof body.roomName === "string" ? body.roomName : "\u4E00\u8D77\u542C").trim().slice(0, 60) || "\u4E00\u8D77\u542C";
      const track = readTrack(body);
      const playing = body.playing === true && Boolean(track);
      const offset = typeof body.offset === "number" && Number.isFinite(body.offset) ? Math.max(0, body.offset) : 0;
      const queue = (Array.isArray(body.queue) ? body.queue : []).slice(0, QUEUE_LIMIT).map((item) => readTrackVal(item)).filter((t) => Boolean(t && t.id !== track?.id));
      this.room = {
        code,
        name: roomName,
        hostId: actorId,
        createdAt: now2,
        updatedAt: now2,
        state: track ? { mode: playing ? "playing" : "idle", track, startedAt: playing ? now2 : 0, offset, serverAt: now2, hostAt: typeof body.hostAt === "number" ? body.hostAt : now2 } : { mode: "idle", track: null, startedAt: 0, offset: 0, serverAt: now2, hostAt: now2 },
        queue,
        queueAt: now2,
        members: [{ id: actorId, name: actorName, joinedAt: now2, lastSeen: now2 }],
        chat: []
      };
      this.markDirty();
      this.scheduleCleanup();
      return json(this.room);
    }
    const room = await this.ensure();
    if (!room) return json({ error: "room_not_found" }, 404);
    if (!actorId) return json({ error: "missing_id" }, 400);
    const now = Date.now();
    const touch = /* @__PURE__ */ __name(() => {
      const existing = room.members.find((m) => m.id === actorId);
      const member = existing ? { ...existing, name: actorName || existing.name, lastSeen: now } : { id: actorId, name: actorName, joinedAt: now, lastSeen: now };
      room.members = [...room.members.filter((m) => m.id !== actorId), member];
    }, "touch");
    if (action === "join") {
      touch();
      const message = { id: crypto.randomUUID(), name: actorName, text: "\u52A0\u5165\u4E86\u623F\u95F4", at: now };
      room.chat.push(message);
      room.updatedAt = now;
      this.markDirty();
      return json(prune(room));
    }
    if (action === "leave") {
      room.members = room.members.filter((m) => m.id !== actorId);
      room.updatedAt = now;
      this.markDirty();
      if (!room.members.length) {
        void this.state.storage.setAlarm(now + 6e4);
      }
      return json(prune(room));
    }
    if (action === "heartbeat") {
      touch();
      room.updatedAt = now;
      this.markDirty();
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
        hostAt: typeof body.hostAt === "number" ? body.hostAt : now
      };
      room.updatedAt = now;
      this.markDirty();
      return json(prune(room));
    }
    if (action === "pause") {
      touch();
      const offset = typeof body.offset === "number" && Number.isFinite(body.offset) ? Math.max(0, body.offset) : room.state.mode === "playing" ? room.state.offset + Math.max(0, (now - (room.state.serverAt || now)) / 1e3) : room.state.offset;
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
      const order = Array.isArray(body.order) ? body.order.filter((v) => typeof v === "string") : [];
      if (!order.length) return json({ error: "missing_order" }, 400);
      touch();
      const byId = new Map(room.queue.map((t) => [t.id, t]));
      const reordered = [];
      for (const id of order) {
        const t = byId.get(id);
        if (t) {
          reordered.push(t);
          byId.delete(id);
        }
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
      const message = { id: crypto.randomUUID(), name: actorName, text, at: now };
      room.chat.push(message);
      room.updatedAt = now;
      this.markDirty();
      return json(prune(room));
    }
    return json({ error: "unknown_action" }, 400);
  }
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
__name(json, "json");
function asRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}
__name(asRecord, "asRecord");
function readTrack(body) {
  return readTrackVal(body.track);
}
__name(readTrack, "readTrack");
function readTrackVal(v) {
  const r = asRecord(v);
  if (!r) return null;
  const id = typeof r.id === "string" ? r.id : "";
  const title = typeof r.title === "string" ? r.title : "";
  const artist = typeof r.artist === "string" ? r.artist : "";
  if (!id || !title) return null;
  const coverUrl = typeof r.coverUrl === "string" ? r.coverUrl : void 0;
  const duration = typeof r.duration === "number" ? r.duration : void 0;
  return { id, title, artist, ...coverUrl ? { coverUrl } : {}, ...duration ? { duration } : {} };
}
__name(readTrackVal, "readTrackVal");
var party_room_default = {
  fetch() {
    return new Response("yvxi-party-room DO worker", { status: 200 });
  }
};
export {
  PartyRoomDO,
  party_room_default as default
};
//# sourceMappingURL=party-room.js.map
