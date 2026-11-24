# Yuxi backend

The site is built as static Astro pages. Caddy serves those pages and proxies
`/netease/*`, `/audio/*` and `/api/health` to this service on `127.0.0.1:8787`.
No Cloudflare Worker, KV or Durable Object binding is required by this backend.

## Run

Use Node.js 24 LTS, or Node.js 22.13 or later with the built-in `node:sqlite`
module. Install only the small server dependency tree on the origin:

```sh
cd server
npm ci --omit=dev --ignore-scripts
node index.mjs
```

`qrcode` is the only production dependency. It is loaded when a visitor asks
for a NetEase login QR code; room, health and audio routes use Node built-ins.
The backend calls the same `https://music.163.com/api/` endpoints as the previous
Pages Function. It does not depend on the retired Hermes host, an external
NeteaseCloudMusicApi demo instance, or the old Python proxy.

The systemd example is `../deploy/yuxi-backend.service`. Change the Node and
release paths to match the installation. Create the unprivileged `yuxi`
system user before enabling it. Its `StateDirectory=yuxi` owns the private
runtime files; application releases remain read-only to that user.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listener port; host is always loopback. |
| `YUXI_ORIGIN` | `https://yvxi.cyjin.dev` | Accepted browser Origin and secure-cookie mode. |
| `YUXI_DB` | `/var/lib/yuxi/yuxi.sqlite` | Persistent rooms, sessions and pending QR keys. |
| `YUXI_KEY_FILE` | Database filename plus `.key` | Private 32-byte AES-GCM key, created once with mode `0600`. The unit uses `/var/lib/yuxi/session.key`. |
| `YUXI_AUDIO_DIR` | `/var/lib/yuxi/audio` | Optional original `.m4a` files, served without an external fetch. |
| `YUXI_TRUST_PROXY` | Off | Set to `1` only behind the loopback reverse proxy. Rate limiting then uses its last `X-Forwarded-For` hop. |
| `NETEASE_IMPORT_TOKEN` | Disabled | A separate random token of at least 24 characters for the optional operator cookie-import route. Store in the root-owned environment file; do not use the Life broker passphrase. |

`GET /api/health` checks the opened SQLite connection and returns a small status
object. It exposes neither paths, credentials, account identity nor room counts.

## Existing clients

The URLs and room JSON shape remain compatible with the site's player:

- `GET /netease/party`: active room list, calculated from current membership.
- `POST /netease/party/create`: create a room. A code collision retries a unique
  SQLite insert; it never replaces a previous room.
- `GET /netease/party/CODE` and `POST /netease/party/CODE/{join,leave,heartbeat,play,pause,queue,reorder,chat}`.
- `POST /netease/auth/qr/create`, `POST /netease/auth/qr/check`,
  `GET /netease/auth/status` and `POST /netease/auth/logout`.
- `GET /netease/{playlist,song,lyrics,comments,audio}/ID`,
  `GET /netease/search?q=...`, `GET /netease/playlists/mine` and
  `GET /netease/playlist/current`.
- `GET` or `HEAD /audio/FILE.m4a`: original audio, local first and otherwise
  proxied from the existing GitHub release.

Any joined member can still control shared playback. A play action consumes
that track from the shared queue. Reordering preserves queue additions that
arrived after the caller's snapshot. Membership expires after two minutes
without a heartbeat; discovery uses that same rule immediately. Empty rooms
expire one minute after an explicit last leave, or after 24 hours without
activity. Internal maintenance operations are not public HTTP routes.

Mutating requests bind the player's local actor ID to a random HttpOnly browser
session. A different browser cannot claim an already-bound actor ID. If a user
clears cookies but retains local storage, a `409 actor_identity_conflict`
response tells the client to generate a new actor ID and retry once. If the
same session already owns an ID, the response includes that `actorId` instead.
This is a continuity check for an anonymous public room, not a user account.

## NetEase account isolation

QR login belongs to the browser that created the QR key. The result never
overwrites a site-wide login. The session cookie is HttpOnly, SameSite=Lax and
Secure for the production HTTPS origin. NetEase credentials are encrypted in
SQLite with AES-256-GCM, bound to their session hash, and are not returned to
the browser or written to application logs. The opaque browser token is stored
only as a SHA-256 hash in the database.

`/netease/playlists/mine` and `/netease/playlist/current` require that browser's
login. Public metadata routes can work without login when NetEase permits it.
Account-bound streams use `private, no-store`. Metadata caches are bounded,
expire, and are separated by session credentials.

The optional `POST /netease/auth/import` takes JSON `{ "cookie": "MUSIC_U=..." }`
with `Authorization: Bearer ...`. It validates the credential and creates a
login only for that request's browser session. It is disabled when no import
token is configured. Retain the returned HttpOnly session in the operator's
cookie jar if using an authorized CLI; do not put either credential in shell
arguments, source files, a deployment manifest or command logs.

The local room and original audio features work independently of NetEase
availability. Upstream login, regional availability, account expiry and track
rights remain NetEase's decisions; an unavailable track returns a specific
error instead of claiming a successful stream.

## Persistence and backups

Each room mutation commits a SQLite transaction before returning HTTP success.
SQLite uses WAL, `synchronous=FULL` and a bounded busy timeout. The room itself
is the discovery authority, so there is no separate eventually consistent
room index. Sessions and their encrypted credentials survive restarts.

Back up **both the database and its matching key file**, plus any irreplaceable
original audio. The key is generated once and must not be regenerated during
normal deployments. A database without that key cannot recover account cookies.
Database rows and anonymous room state can still be inspected without revealing
those cookies. Keep backups private.

The supplied `../deploy/backup-sqlite.py` uses Python's standard-library online
backup API without stopping the service. It writes a checked database and its
matching key into a private recovery set, then atomically publishes that set.
The `yuxi-backup.service` and daily timer run as root and retain 14 completed
sets by default (7 is also supported). Do not copy just the main `.sqlite` file
while WAL writes are active. Installation, release switching and deliberate
restore steps are in [the origin maintenance guide](../deploy/README.md).

Roll back application code separately from data. The service refuses an
unknown newer database schema version. Replacing a release must not replace
`/var/lib/yuxi`, its key or local media. The current schema is version 1.

## Checks

```sh
node --test tests/backend.test.mjs
```

Run this from the repository root. Tests use real HTTP listeners and temporary
SQLite databases. They exercise restart persistence, concurrent mutations,
collision handling, actor and QR ownership, login isolation, body limits,
expiry, request boundaries and audio byte ranges. NetEase replies are fixtures
in those tests; deployment acceptance also needs live source and public-domain
requests. A successful fixture login does not establish that a real account is
currently logged in.

The SQLite API is documented at
<https://nodejs.org/docs/latest-v24.x/api/sqlite.html>. The HTTP implementation
uses Node's standard server and stream APIs:
<https://nodejs.org/docs/latest-v24.x/api/http.html>.
