/**
 * Durable Object acting as a single, SQLite-backed registry of all rooms.
 *
 * Replaces the previous KV `party-idx:*` index — which burned through
 * the free-tier 1k writes/day quota in under an hour with two open tabs,
 * and silently dropped writes past the limit. The registry is updated
 * only on real membership changes (create/join/leave) — heartbeats
 * stay on the per-room PartyRoomDO.
 */
export interface RoomIndexEntry {
  code: string;
  name: string;
  hostId: string;
  members: number;
  updatedAt: number;
}

export class PartyIndexDO implements DurableObject {
  private tableReady = false;

  constructor(private state: DurableObjectState, _env: unknown) {}

  private ensureTable(): void {
    if (this.tableReady) return;
    this.state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS rooms (" +
      "code TEXT PRIMARY KEY, " +
      "name TEXT NOT NULL, " +
      "hostId TEXT NOT NULL, " +
      "members INTEGER NOT NULL, " +
      "updatedAt INTEGER NOT NULL)"
    );
    this.tableReady = true;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      this.ensureTable();
      const url = new URL(request.url);
      const action = url.pathname.slice(1);

      if (request.method === "POST" && action === "upsert") {
        const body = (await request.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
        const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
        if (!code) return json({ error: "missing_code" }, 400);
        const name = (typeof body.name === "string" ? body.name : "一起听").slice(0, 60) || "一起听";
        const hostId = typeof body.hostId === "string" ? body.hostId : "";
        const members = typeof body.members === "number" && Number.isFinite(body.members) ? Math.max(0, Math.floor(body.members)) : 0;
        const updatedAt = typeof body.updatedAt === "number" ? body.updatedAt : Date.now();

        this.state.storage.sql.exec(
          "INSERT OR REPLACE INTO rooms (code, name, hostId, members, updatedAt) VALUES (?, ?, ?, ?, ?)",
          code, name, hostId, members, updatedAt
        );
        return json({ ok: true });
      }

      if (action === "remove") {
        const code = (url.searchParams.get("code") || "").toUpperCase();
        if (!code) return json({ error: "missing_code" }, 400);
        this.state.storage.sql.exec("DELETE FROM rooms WHERE code = ?", code);
        return json({ ok: true });
      }

      if (action === "list") {
        const actorId = url.searchParams.get("actorId") || "";
        const rows = this.state.storage.sql
          .exec("SELECT code, name, hostId, members FROM rooms WHERE members > 0 ORDER BY members DESC")
          .toArray() as { code: string; name: string; hostId: string; members: number }[];
        const rooms = rows.map((r) => ({
          code: r.code,
          name: r.name,
          members: r.members,
          host: r.hostId === actorId,
        }));
        return json({ rooms });
      }

      return json({ error: "unknown_action" }, 400);
    } catch (err) {
      // Surface the actual exception so a SQL/parse error doesn't masquerade
      // as an opaque 1101 to the Pages function caller.
      return json({ error: "index_error", message: err instanceof Error ? err.message : String(err) }, 500);
    }
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
