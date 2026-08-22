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

/** Discovery rows expire: a room whose membership hasn't changed for 6h is
 *  either dead (browser closed without leave) or inactive. Either way it
 *  shouldn't advertise itself forever. The room DO keeps its own state; this
 *  TTL only affects the /list discovery surface. */
const ROW_TTL_MS = 6 * 3600 * 1000;
const SWEEP_INTERVAL_MS = 3600 * 1000;

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
        // Keep exactly one alarm scheduled for the next sweep.
        const current = await this.state.storage.getAlarm();
        if (current === null) void this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
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
          .exec("SELECT code, name, hostId, members FROM rooms WHERE members > 0 ORDER BY members DESC, updatedAt DESC")
          .toArray() as { code: string; name: string; hostId: string; members: number }[];
        const rooms = rows.map((r) => ({
          code: r.code,
          name: r.name,
          members: r.members,
          host: r.hostId === actorId,
        }));
        return json({ rooms });
      }

      if (action === "sweep") {
        // Maintenance endpoint: run the same prune alarm() runs. Lets ops
        // (and tests) force a sweep without waiting an hour.
        await this.alarm();
        const remaining = this.state.storage.sql
          .exec("SELECT COUNT(*) AS n FROM rooms")
          .toArray() as { n: number }[];
        return json({ ok: true, remaining: remaining[0]?.n ?? 0 });
      }

      return json({ error: "unknown_action" }, 400);
    } catch (err) {
      // Surface the actual exception so a SQL/parse error doesn't masquerade
      // as an opaque 1101 to the Pages function caller.
      return json({ error: "index_error", message: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  /** Hourly sweep: drop rows untouched past ROW_TTL_MS. */
  async alarm(): Promise<void> {
    this.ensureTable();
    this.state.storage.sql.exec("DELETE FROM rooms WHERE updatedAt < ?", Date.now() - ROW_TTL_MS);
    // Re-arm only if rows remain — an empty registry needs no further sweeps.
    const remaining = this.state.storage.sql.exec("SELECT COUNT(*) AS n FROM rooms").toArray() as { n: number }[];
    if ((remaining[0]?.n ?? 0) > 0) void this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
