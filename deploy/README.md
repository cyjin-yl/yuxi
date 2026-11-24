# Origin maintenance

The public host is `yvxi.cyjin.dev`: Cloudflare proxies HTTPS to Caddy on OVH.
Caddy serves the static build and forwards the API to the loopback-only Node
service. Keep the existing Cloudflare Pages, Worker, KV and Durable Object
resources during the migration; this directory does not remove any of them.

## Files and ownership

| Path | Owner and role |
| --- | --- |
| `/srv/yuxi/releases/RELEASE_ID/site` | Root-owned Astro build, readable by Caddy. |
| `/srv/yuxi/releases/RELEASE_ID/server` | Root-owned backend and its production dependencies, readable by `yuxi`. |
| `/srv/yuxi/current` | Root-managed symlink to one complete release. |
| `/var/lib/yuxi` | `yuxi:yuxi`, mode `0700`; persistent SQLite, key and optional original audio. |
| `/etc/yuxi/backend.env` | Optional root-owned mode `0600` environment file. |
| `/var/backups/yuxi` | `root:root`, mode `0700`; complete database/key recovery sets. |
| `/usr/local/libexec/yuxi-backup.py` | Root-owned installed copy of the backup script. |

Neither a new release nor a code rollback should replace the persistent
directory. The database and `session.key` belong together. Regenerating the key
leaves previously encrypted NetEase credentials unreadable. Backups contain
that key as well as the database and must be handled as credentials.

## Online backups

`backup-sqlite.py` uses Python's standard-library
[`sqlite3.Connection.backup()`](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup).
It includes committed WAL data while the backend remains running, checks the
copied database, and creates a standalone SQLite file plus its matching 32-byte
key. Python 3.11 or newer is required; there are no pip dependencies.

Each recovery set contains `yuxi.sqlite`, `session.key`, `manifest.json` and
`SHA256SUMS`. Files are mode `0600` and directories mode `0700`. Only a fully
written, checked and synced directory becomes a completed backup. A failed
attempt does not retire older backups. Retention accepts 7 or 14 completed
sets, defaulting to 14. A process lock prevents overlapping runs.

Run these installation commands as root from a reviewed checkout:

```sh
install -d -o root -g root -m 0700 /var/backups/yuxi
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 deploy/backup-sqlite.py /usr/local/libexec/yuxi-backup.py
install -o root -g root -m 0644 deploy/yuxi-backup.service /etc/systemd/system/yuxi-backup.service
install -o root -g root -m 0644 deploy/yuxi-backup.timer /etc/systemd/system/yuxi-backup.timer
systemctl daemon-reload
systemctl start yuxi-backup.service
systemctl enable --now yuxi-backup.timer
systemctl list-timers yuxi-backup.timer
```

The timer runs daily at 03:20 UTC with up to 20 minutes of jitter, and catches
up after missed runs. Check failures with `systemctl status yuxi-backup.service`
and `journalctl -u yuxi-backup.service`. The script logs status and backup IDs,
never the database contents, session tokens or encryption key.

For 7 sets, put `YUXI_BACKUP_KEEP=7` in root-owned mode `0600`
`/etc/yuxi/backup.env`. Source paths must match the backend environment. If
changing paths, also adjust the backup unit's `ReadOnlyPaths` and
`ReadWritePaths`; systemd's sandbox deliberately limits filesystem access.
The source is opened read-only. Run the first unit check with the live service
and its normal WAL/SHM files present; never add `immutable=1` to a live SQLite
source to get around an access error.

The script does not copy original audio, application releases, the origin TLS
certificate or environment files. Back up irreplaceable media and deployment
configuration separately. These local recovery sets protect against application
mistakes; disaster recovery also needs an access-controlled copy off the origin.
Key rotation requires a coordinated database/key procedure and is not part of
routine deployment. The script rejects a key that changes during a backup.

## Release changes

Build and test in a separate checkout, then upload a complete new release
directory. Include `site/` from the static build and `server/` with its lockfile;
run `npm ci --omit=dev --ignore-scripts` inside that release's `server/`.
Do not install the Astro toolchain on the origin merely to run the backend.
Release files are root-owned and read-only to the service user.

Keep previously served hashed files in `site/_astro/` available across the
browser/CDN cache window: an already-open page can import an older player chunk
after the new release becomes current. Only retain immutable build assets from
previously public releases, not old HTML or private source drafts.

Take an online backup before changing the running application. Record the
current symlink target, then replace it by a same-filesystem rename. This sample
assumes the complete release directory already exists and `current.next` does
not exist; `RELEASE_ID` is an operator-selected identifier:

```sh
release_dir=/srv/yuxi/releases/RELEASE_ID
previous_release=$(readlink -f /srv/yuxi/current)
systemctl start yuxi-backup.service
ln -s "$release_dir" /srv/yuxi/current.next
mv -Tf /srv/yuxi/current.next /srv/yuxi/current
systemctl restart yuxi-backend.service
curl --fail --silent --show-error http://127.0.0.1:8787/api/health
```

Then check the public HTTPS pages, a real metadata request, a room interaction,
and a known audio byte range. A process merely exiting successfully does not
prove it listened. If an application check fails, switch `current` back to the
recorded release and restart; preserve the persistent data directory. The
current schema version is 1, and the backend refuses an unknown newer version.
Do not lower `PRAGMA user_version` to force an old release to open new data.

Caddy reload is necessary only when its configuration changes. Validate a
changed configuration before reloading it. Keep origin TLS certificate and
private key files outside releases, with their existing restricted permissions.

## Restore a database and key

Restoring is a deliberate rollback of rooms, sessions and login state, so it
does require a short backend stop. It is separate from a code-only rollback.
Choose a completed recovery set and an application release compatible with its
`schemaVersion` before replacing anything.

1. Verify `SHA256SUMS` inside the selected private directory with
   `sha256sum -c SHA256SUMS`. Open its database read-only and run
   `PRAGMA quick_check`; expect `ok`. Check the manifest's schema version.
2. If the current database is healthy, create one additional online backup.
   Stop `yuxi-backup.timer`, wait for any active backup job to finish, then stop
   `yuxi-backend.service`. Do not replace live SQLite files.
3. Preserve the current `yuxi.sqlite`, any `yuxi.sqlite-wal` and
   `yuxi.sqlite-shm`, and `session.key` together in a new root-only rescue
   directory. Move rather than discard them. Do not leave old WAL/SHM files
   beside the restored database.
4. Install the selected `yuxi.sqlite` and matching `session.key` into
   `/var/lib/yuxi`, owned by `yuxi:yuxi` with mode `0600`. Keep the directory
   mode `0700` and preserve its existing audio directory.
5. Start the compatible backend release. Check health, logs, room mutations and
   persistence across a restart. Existing memberships and credentials may have
   expired since the snapshot; the restore does not extend their lifetimes.
6. Restart `yuxi-backup.timer` after acceptance. Retain the rescue directory
   until the recovery is accepted; it is not subject to automatic retention.

Never display the key or copy it into a command argument. A valid checksum
confirms file transfer integrity, not that a NetEase account remains logged in.

## Cloudflare fallback

Preserve the original Pages project, Workers, bindings and routing record in the
private operations archive. If the origin cutover must be reverted, restore the
previous reviewed DNS/custom-domain routing and check HTTPS and the old APIs
before treating the rollback as complete. Keep the OVH release and SQLite/key
set intact for investigation.

New OVH room state and per-browser encrypted logins are not automatically
replicated into the old KV/Durable Object resources. Routing back can therefore
restore the old application without carrying over newly created sessions and
rooms. Do not delete old Cloudflare resources or treat code rollback as data
migration until that distinction has been reviewed.
