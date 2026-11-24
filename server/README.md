# Yuxi backend

Caddy serves the static Astro site and forwards `/netease/*`, `/audio/*` and
`/api/health` to this Node.js service on `127.0.0.1:8787`. The server provides
public NetEase music browsing, audio streams and persistent listening rooms.

## Run

Use Node.js 24 LTS, or Node.js 22.13 or later with the built-in `node:sqlite`
module. The server uses Node's standard library and starts directly:

```sh
node server/index.mjs
```

The systemd unit is `../deploy/yuxi-backend.service`. Set its Node and release
paths for the installation and create the `yuxi` system user before enabling
it. `StateDirectory=yuxi` gives that user a private runtime directory while
application releases remain read-only.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Loopback listener port. |
| `YUXI_ORIGIN` | `https://yvxi.cyjin.dev` | Browser Origin and secure-cookie mode. |
| `YUXI_DB` | `/var/lib/yuxi/yuxi.sqlite` | Rooms and anonymous browser identities. |
| `YUXI_AUDIO_DIR` | `/var/lib/yuxi/audio` | Original `.m4a` audio files. |
| `YUXI_TRUST_PROXY` | Off | Set to `1` behind the loopback reverse proxy so rate limits use its last `X-Forwarded-For` hop. |

`GET /api/health` checks the SQLite connection and returns the service and
schema version.

## Music

The first music request obtains an anonymous visitor session directly from
NetEase through its xeapi key exchange and registration endpoints. Each new
session starts with a fresh device identifier. Concurrent requests share
that registration. Credentials stay in process memory and are renewed after
six hours or earlier if their cookie expires. Failed visitor registration
pauses new attempts for 30 seconds. Restarting the server creates a fresh
visitor on the next request.

Visitors can search music, open public playlists and play tracks available to
anonymous listeners. Enter a public playlist ID or link in the collection
page to load it. These routes use the server's visitor session:

- `GET /netease/search?q=TEXT&limit=30&offset=0`
- `GET /netease/playlist/ID`
- `GET /netease/song/ID`
- `GET /netease/lyrics/ID`
- `GET /netease/comments/ID?limit=20&offset=0`
- `GET` or `HEAD /netease/audio/ID`

Metadata uses a bounded in-memory cache. A playlist permission response
returns `netease_resource_unavailable` and keeps the current visitor session
available for other public music. Audio streams support byte ranges,
and unavailable tracks return `audio_unavailable` with the upstream track
code. The browser displays that state and can continue to another track.

`GET` or `HEAD /audio/FILE.m4a` serves the original collection from the local
audio directory. A missing local file is fetched from the existing GitHub
audio release. Local audio and listening rooms work independently of NetEase.

## Listening rooms

- `GET /netease/party` returns `{ "rooms": [...] }` for active rooms.
- `POST /netease/party/create` creates a room and returns its room object.
- `GET /netease/party/CODE` returns the room object.
- `POST /netease/party/CODE/{join,leave,heartbeat,play,pause,queue,reorder,chat}`
  changes the room and returns the updated room object.

The room object contains `code`, `name`, `hostId`, `state`, `queue`, `members`
and `chat`. Any joined member can control shared playback. Playing a queued
track consumes its queue entry; reordering keeps entries added since the
caller's snapshot. Membership expires after two minutes without a heartbeat.
Empty rooms expire one minute after the last explicit leave, or after
24 hours without activity.

A random HttpOnly browser cookie binds the player's local actor ID to its
room identity. SQLite stores a hash of the browser token. If cookies were
cleared while local storage remains, `409 actor_identity_conflict` tells the
client to choose a new actor ID and retry once. When the current browser
session already owns an ID, the response includes that `actorId` for reuse.

## SQLite runtime data

Each room mutation commits before the HTTP response succeeds. SQLite uses
WAL, `synchronous=FULL` and a bounded busy timeout. Rooms, queues, chat and
browser identity survive a process restart. The active room list is computed
from room membership.

Deploy the site and server together. The first start with schema version 2
retains rooms and browser identities, removes the account-cookie column and
pending login rows, and truncates the migration journal. Runtime data lives
under `/var/lib/yuxi`, separately from application releases and the original
audio files. Release management is described in the
[origin maintenance guide](../deploy/README.md).

## Development

Run the HTTP, SQLite migration and streaming checks from the repository root:

```sh
node --test tests/backend*.test.mjs
```

The Node.js documentation describes the
[SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html),
[HTTP server](https://nodejs.org/docs/latest-v24.x/api/http.html) and
[cryptographic primitives](https://nodejs.org/docs/latest-v24.x/api/crypto.html).

The visitor wire format follows the maintained API implementation's
[anonymous registration](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/23d9e9d7ee5dfeccfc3b15916ccd9da1f76d3ea4/module/register_anonimous.js),
[key exchange](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/23d9e9d7ee5dfeccfc3b15916ccd9da1f76d3ea4/module/register_xeapikey.js)
and [xeapi envelope](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/23d9e9d7ee5dfeccfc3b15916ccd9da1f76d3ea4/util/crypto.js).
