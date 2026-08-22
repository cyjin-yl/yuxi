import QRCode from "qrcode";

 interface Env {
   NETEASE_IMPORT_TOKEN: string;
   NETEASE_AUTH: KVNamespace;
   PARTY_ROOM: DurableObjectNamespace;
   PARTY_INDEX: DurableObjectNamespace;
 }

const ID = /^[1-9][0-9]{0,19}$/;
const API = "https://music.163.com";
const NO_STORE = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const PLAYLIST_NAME = "English Essentials 40 —";

const json = (value: unknown, status = 200, cache = "no-store") => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": cache },
});

const DEVICE_ID = "yvxi-pages-player-0001";
const WNMCID = `yvxi.${Date.now()}.01.0`;
const API_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// NetEase's CDN rejects stream URLs resolved from a bare MUSIC_U session with
// "auth failed - origin failed". Augmenting the cookie with the same web-player
// fingerprint NeteaseCloudMusicApi injects makes the resolved URL downloadable.
function sessionCookie(raw: string): string {
  if (!raw.startsWith("MUSIC_U=")) return raw;
  const nuid = crypto.randomUUID().replace(/-/g, "");
  const nmtid = crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  return [
    raw,
    "__remember_me=true",
    "ntes_kaola_ad=1",
    `_ntes_nuid=${nuid}`,
    `_ntes_nnid=${nuid},${now}`,
    `WNMCID=${WNMCID}`,
    "WEVNSM=1.0.0",
    "osver=Microsoft-Windows-10-Professional-build-19045-64bit",
    `deviceId=${DEVICE_ID}`,
    "os=pc",
    "channel=netease",
    "appver=3.1.17.204416",
    `NMTID=${nmtid}`,
  ].join("; ");
}

async function netease(path: string, currentCookie: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", API_UA);
  headers.set("Referer", "https://music.163.com/");
  if (currentCookie) headers.set("Cookie", sessionCookie(currentCookie));
  return fetch(`${API}${path}`, { ...init, headers });
}

async function apiJson(path: string, currentCookie: string, init: RequestInit = {}): Promise<unknown> {
  const response = await netease(path, currentCookie, init);
  if (!response.ok) throw new Error(`NetEase ${response.status}`);
  return response.json();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function formInit(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  };
}

function readMusicCookie(body: unknown, response: Response): string | null {
  const candidates: string[] = [];
  const record = asRecord(body);
  if (typeof record?.cookie === "string") candidates.push(record.cookie);
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  candidates.push(...setCookies);
  const combined = response.headers.get("set-cookie");
  if (combined) candidates.push(combined);
  for (const candidate of candidates) {
    const match = /MUSIC_U\s*=\s*([^;]+)/.exec(candidate);
    if (match?.[1]) {
      try {
        return `MUSIC_U=${decodeURIComponent(match[1])}`;
      } catch {
        return `MUSIC_U=${match[1]}`;
      }
    }
  }
  return null;
}

async function createQrLogin(): Promise<Response> {
  const keyBody = asRecord(await apiJson("/api/login/qrcode/unikey", "", formInit({ type: "3" })));
  const unikey = typeof keyBody?.unikey === "string" ? keyBody.unikey : "";
  if (keyBody?.code !== 200 || !unikey) return json({ error: "qr_key_failed" }, 502);
  const qrUrl = `https://music.163.com/login?codekey=${encodeURIComponent(unikey)}`;
  const qrSvg = await QRCode.toString(qrUrl, { type: "svg", width: 320, margin: 1 });
  const qrImg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`;
  return json({ key: unikey, qrUrl, qrImg });
}

async function checkQrLogin(env: Env, request: Request): Promise<Response> {
  const body = request.method === "POST" ? asRecord(await request.json().catch(() => ({}))) : null;
  const key = typeof body?.key === "string" ? body.key : new URL(request.url).searchParams.get("key") || "";
  if (!key || key.length > 100) return json({ error: "missing_qr_key" }, 400);
  const response = await netease("/api/login/qrcode/client/login", "", formInit({ key, type: "3" }));
  const result = asRecord(await response.json().catch(() => ({}))) ?? {};
  const code = typeof result.code === "number" ? result.code : 0;
  const message = typeof result.message === "string" ? result.message : "";
  if (code !== 803) return json({ code, message });
  const cookie = readMusicCookie(result, response);
  if (!cookie) return json({ code, error: "login_cookie_missing" }, 502);
  const profile = await validate(cookie);
  if (!profile) return json({ code, error: "login_cookie_invalid" }, 502);
  await env.NETEASE_AUTH.put("session-cookie", cookie);
  return json({ code, authenticated: true, profile });
}

// Narrow NetEase /api/nuser/account/get to an authenticated profile.
function readProfile(value: unknown): { userId: number; nickname?: string } | null {
  const body = asRecord(value);
  if (!body || body.code !== 200) return null;
  const profile = asRecord(body.profile);
  if (!profile || typeof profile.userId !== "number") return null;
  return { userId: profile.userId, nickname: typeof profile.nickname === "string" ? profile.nickname : undefined };
}

// Narrow /api/user/playlist to playlist summaries.
function readPlaylistSummaries(value: unknown): { id: number; name: string }[] {
  const body = asRecord(value);
  const list = Array.isArray(body?.playlist) ? body.playlist : [];
  const out: { id: number; name: string }[] = [];
  for (const item of list) {
    const record = asRecord(item);
    if (record && typeof record.id === "number" && typeof record.name === "string") {
      out.push({ id: record.id, name: record.name });
    }
  }
  return out;
}

// NetEase returns playlist.tracks newest-first while trackIds keeps the real
// playlist order — reorder so clients can render tracks as the user sees them.
function normalizePlaylist(value: unknown): unknown {
  const body = asRecord(value);
  const playlist = asRecord(body?.playlist);
  const trackIds = playlist?.trackIds;
  const tracks = playlist?.tracks;
  if (!playlist || !Array.isArray(trackIds) || !Array.isArray(tracks)) return value;
  const byId = new Map<string, unknown>();
  for (const track of tracks) {
    const record = asRecord(track);
    if (record && typeof record.id === "number") byId.set(String(record.id), track);
  }
  const ordered: unknown[] = [];
  for (const ref of trackIds) {
    const record = asRecord(ref);
    if (record && typeof record.id === "number") {
      const track = byId.get(String(record.id));
      if (track) ordered.push(track);
    }
  }
  playlist.tracks = ordered;
  return value;
}

// Narrow /api/song/enhance/player/url/v1 to the first stream URL.
function readStreamUrl(value: unknown): { url: string | null; code: number | null } {
  const body = asRecord(value);
  const entry = asRecord(Array.isArray(body?.data) ? body.data[0] : null);
  return {
    url: entry && typeof entry.url === "string" ? entry.url : null,
    code: entry && typeof entry.code === "number" ? entry.code : null,
  };
}

async function validate(currentCookie: string): Promise<{ userId: number; nickname?: string } | null> {
  if (!currentCookie.startsWith("MUSIC_U=")) return null;
  return readProfile(await apiJson("/api/nuser/account/get", currentCookie));
}

async function currentPlaylist(currentCookie: string): Promise<unknown> {
  const profile = await validate(currentCookie);
  if (!profile) throw new Error("netease_auth_required");
  const playlists = readPlaylistSummaries(
    await apiJson(`/api/user/playlist?uid=${profile.userId}&limit=1000&offset=0`, currentCookie),
  );
  const playlist = playlists.find((item) => item.name.startsWith(PLAYLIST_NAME));
  if (!playlist) throw new Error("english_playlist_not_found");
  return normalizePlaylist(await apiJson(`/api/v6/playlist/detail?id=${playlist.id}&n=1000&s=0`, currentCookie));
}

// ---------------------------------------------------------------------------
// Listen-together rooms (Durable Object backed — strong consistency)
// ---------------------------------------------------------------------------

const ROOM_CODE_RE = /^[A-Z2-9]{4}$/;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newRoomCode(): string {
  let s = "";
  const buf = crypto.getRandomValues(new Uint8Array(4));
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return s;
}

function readTrackValue(v: unknown): { id: string; title: string; artist: string; coverUrl?: string; duration?: number } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const title = typeof r.title === "string" ? r.title : "";
  const artist = typeof r.artist === "string" ? r.artist : "";
  if (!id || !title) return null;
  return { id, title, artist, ...(typeof r.coverUrl === "string" ? { coverUrl: r.coverUrl } : {}), ...(typeof r.duration === "number" ? { duration: r.duration } : {}) };
}

/** Thin proxy: all room logic lives in the PartyRoomDO. */
async function handleParty(env: Env, parts: string[], request: Request): Promise<Response> {
  const body: Record<string, unknown> =
    request.method === "POST" ? (asRecord(await request.json().catch(() => ({}))) ?? {}) : {};
  const actorId = typeof body.id === "string" ? body.id : "";
  // GET /netease/party — list active rooms from the PartyIndexDO singleton.
  // Reads only — never touches KV, so free-tier write quota is irrelevant.
  if (parts[2] === undefined && request.method === "GET") {
    const indexStub = env.PARTY_INDEX.get(env.PARTY_INDEX.idFromName("INDEX"));
    const resp = await indexStub.fetch(new Request(`https://idx/list?actorId=${encodeURIComponent(actorId)}`));
    return resp;
  }

  // POST /netease/party/create
  if (parts[2] === "create" && request.method === "POST") {
    if (!actorId) return json({ error: "missing_id" }, 400);
    const code = newRoomCode();
    // No KV collision check — the index DO uses code as primary key; if it
    // already exists, the upsert overwrites (last-create-wins on a true
    // duplicate code, which is astronomically rare with 4 alphanumeric chars).
    const stub = env.PARTY_ROOM.get(env.PARTY_ROOM.idFromName(code));
    const resp = await stub.fetch(new Request(`https://do/create?code=${code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    if (!resp.ok) return resp;
    const room = await resp.json() as Record<string, unknown>;
    // Register in the index DO. Failures here don't break the room operation
    // — the room still exists in PARTY_ROOM, just won't appear in /list.
    try {
      const indexStub = env.PARTY_INDEX.get(env.PARTY_INDEX.idFromName("INDEX"));
      await indexStub.fetch(new Request("https://idx/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name: room.name,
          hostId: room.hostId,
          members: (room.members as unknown[]).length,
          updatedAt: Date.now(),
        }),
      }));
    } catch { /* index stale is acceptable */ }
    return json(room);
  }

  // All other routes: /netease/party/{CODE}/{action}
  const code = String(parts[2] ?? "").toUpperCase();
  if (!ROOM_CODE_RE.test(code)) return json({ error: "invalid_room_code" }, 400);
  const action = parts[3] || "get";
  const stub = env.PARTY_ROOM.get(env.PARTY_ROOM.idFromName(code));
  const resp = await stub.fetch(new Request(`https://do/${action}`, {
    method: request.method,
    headers: { "Content-Type": "application/json" },
    body: request.method === "POST" ? JSON.stringify(body) : undefined,
  }));
  // Refresh the index ONLY on real membership changes. Heartbeats are
  // absorbed by PartyRoomDO; the index only needs discovery metadata.
  if (resp.ok && (action === "join" || action === "leave")) {
    try {
      const room = await resp.clone().json() as Record<string, unknown>;
      const members = (room.members as unknown[]).length;
      const indexStub = env.PARTY_INDEX.get(env.PARTY_INDEX.idFromName("INDEX"));
      if (members > 0) {
        await indexStub.fetch(new Request("https://idx/upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            name: room.name,
            hostId: room.hostId,
            members,
            updatedAt: Date.now(),
          }),
        }));
      } else {
        await indexStub.fetch(new Request(`https://idx/remove?code=${code}`));
      }
    } catch { /* index stale is acceptable */ }
  }
  return resp;
}

// ---------------------------------------------------------------------------

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    if (url.pathname === "/netease/auth/import" && request.method === "POST") {
      if (`Bearer ${env.NETEASE_IMPORT_TOKEN}` !== request.headers.get("Authorization")) return new Response("Unauthorized", { status: 401 });
      const body = asRecord(await request.json());
      const supplied = typeof body?.cookie === "string" ? body.cookie.trim() : "";
      const profile = await validate(supplied);
      if (!profile) return json({ error: "invalid_netease_cookie" }, 400);
      await env.NETEASE_AUTH.put("session-cookie", supplied);
      return json({ authenticated: true, userId: profile.userId, nickname: profile.nickname });
    }

    if (url.pathname === "/netease/auth/qr/create" && request.method === "POST") {
      return await createQrLogin();
    }
    if (url.pathname === "/netease/auth/qr/check" && (request.method === "POST" || request.method === "GET")) {
      return await checkQrLogin(env, request);
    }

    const currentCookie = (await env.NETEASE_AUTH.get("session-cookie")) || "";
    if (url.pathname === "/netease/auth/status") {
      const profile = await validate(currentCookie);
      return json({ authenticated: Boolean(profile), profile: profile ? { userId: profile.userId, nickname: profile.nickname } : null });
    }
    // Listen-together rooms are public and must work without a NetEase cookie.
    // Route them before the session gate so join/heartbeat never 401.
    if (parts[0] === "netease" && parts[1] === "party") return handleParty(env, parts, request);
    if (!currentCookie) return json({ error: "netease_auth_required" }, 401);

    if (url.pathname === "/netease/playlist/current") {
      return json(await currentPlaylist(currentCookie), 200, "private, max-age=300");
    }
    if (url.pathname === "/netease/playlists/mine") {
      const profile = await validate(currentCookie);
      if (!profile) return json({ error: "netease_auth_required" }, 401);
      const body = asRecord(await apiJson(`/api/user/playlist?uid=${profile.userId}&limit=1000&offset=0`, currentCookie));
      const list = Array.isArray(body?.playlist) ? body.playlist : [];
      const playlists: { id: string; name: string; coverUrl: string | null; trackCount: number }[] = [];
      for (const item of list) {
        const record = asRecord(item);
        if (!record || typeof record.id !== "number" || typeof record.name !== "string") continue;
        playlists.push({
          id: String(record.id),
          name: record.name,
          coverUrl: typeof record.coverImgUrl === "string" ? record.coverImgUrl : null,
          trackCount: typeof record.trackCount === "number" ? record.trackCount : 0,
        });
      }
      return json({ playlists }, 200, "private, max-age=300");
    }
    if (url.pathname === "/netease/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q) return json({ error: "missing_query" }, 400);
      const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);
      const offset = Number(url.searchParams.get("offset")) || 0;
      const params = new URLSearchParams({ s: q, type: "1", limit: String(limit), offset: String(offset), total: "true" });
      return json(await apiJson(`/api/cloudsearch/pc?${params}`, currentCookie), 200, "private, max-age=60");
    }
    if (parts.length !== 3 || parts[0] !== "netease" || !ID.test(parts[2])) return new Response("Not found", { status: 404 });
    const [, kind, id] = parts;
    if (kind === "playlist") return json(normalizePlaylist(await apiJson(`/api/v6/playlist/detail?id=${id}&n=1000&s=0`, currentCookie)), 200, "private, max-age=300");
    if (kind === "lyrics") {
      return json(
        await apiJson(`/api/song/lyric/v1?id=${id}&cp=false&tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0`, currentCookie),
        200,
        "private, max-age=3600",
      );
    }
    if (kind === "comments") {
      const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
      const offset = Number(url.searchParams.get("offset")) || 0;
      const form = new URLSearchParams({ rid: id, limit: String(limit), offset: String(offset), beforeTime: "0" });
      return json(
        await apiJson(`/api/v1/resource/comments/R_SO_4_${id}`, currentCookie, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        }),
        200,
        "private, max-age=300",
      );
    }
    if (kind === "song") {
      const form = new URLSearchParams({ c: `[{"id":${id}}]` });
      return json(
        await apiJson(`/api/v3/song/detail`, currentCookie, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        }),
        200,
        "private, max-age=3600",
      );
    }
    if (kind === "audio") {
      const form = new URLSearchParams({ ids: `[${id}]`, level: "standard", encodeType: "aac" });
      const resolved = readStreamUrl(
        await apiJson("/api/song/enhance/player/url/v1", currentCookie, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        }),
      );
      if (!resolved.url) return json({ error: "audio_unavailable", code: resolved.code }, 451);
      const mediaHeaders: Record<string, string> = {
        "User-Agent": BROWSER_UA,
        "Referer": "https://music.163.com/",
      };
      if (request.headers.has("Range")) mediaHeaders["Range"] = request.headers.get("Range")!;
      const upstream = await fetch(resolved.url, { headers: mediaHeaders });
      const headers = new Headers(upstream.headers);
      headers.set("Cache-Control", "public, max-age=3600");
      headers.delete("Set-Cookie");
      return new Response(upstream.body, { status: upstream.status, headers });
    }
    return new Response("Not found", { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream_failure";
    const status = message === "netease_auth_required" ? 401 : message === "english_playlist_not_found" ? 404 : 502;
    return new Response(JSON.stringify({ error: message }), { status, headers: NO_STORE });
  }
}
