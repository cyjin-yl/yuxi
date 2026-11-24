#!/usr/bin/env python3
"""Install a verified, complete OVH release without creating database backups."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import subprocess
import time
import urllib.request

ROOT = Path('/srv/yuxi/releases')
CURRENT = Path('/srv/yuxi/current')
STATE = Path('/var/lib/yuxi')
NODE = '/opt/node-v24.22.3-linux-x64/bin/node'
SERVICE = 'yuxi-backend.service'


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_text(path, content, mode):
    temporary = path.with_name(path.name + '.next')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, 'w') as handle:
            os.fchmod(handle.fileno(), mode)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def verify_manifest(release, manifest):
    required = {'site/index.html', 'site/blog/index.html', 'site/blog/search-index.json',
                'server/index.mjs', 'server/storage.mjs', 'server/netease.mjs',
                'server/party.mjs', 'server/media.mjs', 'deploy/install-release.py',
                'deploy/yuxi-backend.service', 'deploy/smoke-backend.mjs'}
    files = manifest['files']
    names = set()
    for item in files:
        name = item['path']
        if not isinstance(name, str) or not name or '\\' in name or '\x00' in name:
            raise RuntimeError('Unsafe manifest path')
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or path.as_posix() != name:
            raise RuntimeError('Unsafe manifest path')
        if name in names or type(item['bytes']) is not int or item['bytes'] < 0 or not re.fullmatch(r'[0-9a-f]{64}', item['sha256']):
            raise RuntimeError('Invalid or duplicate manifest entry')
        names.add(name)
    if not required.issubset(names):
        raise RuntimeError('Incomplete release manifest')
    entries = [release, *release.rglob('*')]
    observed = set()
    for path in entries:
        metadata = path.lstat()
        if stat.S_ISREG(metadata.st_mode):
            if metadata.st_nlink != 1:
                raise RuntimeError('Release contains a hard link')
            observed.add(path.relative_to(release).as_posix())
        elif not stat.S_ISDIR(metadata.st_mode):
            raise RuntimeError('Release contains a symlink or special file')
    if observed != names | {'release-manifest.json'}:
        raise RuntimeError('Release inventory differs from the manifest')
    for item in files:
        data = (release / item['path']).read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise RuntimeError('Release file failed SHA256 verification: ' + item['path'])
    return entries


def retired_backups():
    states = {}
    for name in ('yuxi-backup.timer', 'yuxi-backup.service'):
        result = run('systemctl', 'show', name, '--property=LoadState,ActiveState')
        values = dict(line.split('=', 1) for line in result.stdout.splitlines())
        states[name] = values
        if values.get('ActiveState') != 'inactive' or values.get('LoadState') != 'not-found':
            raise RuntimeError('A retired automatic backup unit is still installed or active')
    return states


def remove_retired_environment(environment):
    removed = []
    if environment.exists():
        keep = []
        for line in environment.read_text().splitlines(keepends=True):
            match = re.match(r'^\s*(?:export\s+)?(YUXI_KEY_FILE|NETEASE_IMPORT_TOKEN)\s*=', line)
            if match:
                removed.append(match[1])
            else:
                keep.append(line)
        if removed:
            atomic_text(environment, ''.join(keep), 0o600)
    return removed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release', type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run as root on the OVH host')
    lock = os.open('/run/yuxi-install.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if not CURRENT.is_symlink():
        raise RuntimeError('The current release must be a symlink')
    previous = CURRENT.resolve(strict=True)
    if previous.parent != ROOT or not previous.is_dir():
        raise RuntimeError('The current release is outside /srv/yuxi/releases')
    release = args.release.resolve(strict=True)
    if release.parent != ROOT or release == previous:
        raise RuntimeError('Expected a new direct child of /srv/yuxi/releases')
    manifest_path = release / 'release-manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != args.manifest_sha256:
        raise RuntimeError('Release manifest SHA256 mismatch')
    manifest = json.loads(manifest_bytes)
    if not re.fullmatch(r'[0-9a-f]{40}', manifest['source_commit']):
        raise RuntimeError('A complete source commit is required')
    entries = verify_manifest(release, manifest)
    retired_backups()
    for path in entries:
        os.chown(path, 0, 0)
        os.chmod(path, 0o755 if path.is_dir() else 0o644)
    database = STATE / 'yuxi.sqlite'
    if not database.is_file():
        raise RuntimeError('The existing application database is missing')
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
        before_schema = db.execute('PRAGMA user_version').fetchone()[0]
    if before_schema not in (1, 2):
        raise RuntimeError('Unexpected existing database schema')
    for path in (release / 'server').glob('*.mjs'):
        run(NODE, '--check', str(path))
    unit = release / 'deploy/yuxi-backend.service'
    run('systemd-analyze', 'verify', str(unit))
    smoke = run('runuser', '-u', 'yuxi', '--', NODE,
                str(release / 'deploy/smoke-backend.mjs'),
                str(release / 'server/index.mjs'), str(STATE / 'audio'))
    smoke_result = json.loads(smoke.stdout.strip().splitlines()[-1])
    if not smoke_result.get('ok'):
        raise RuntimeError('Isolated backend smoke failed')
    next_link = CURRENT.with_name('current.next')
    if next_link.exists() or next_link.is_symlink():
        raise RuntimeError('An unexpected pending current.next already exists')
    next_link.symlink_to(release)
    stop_attempted = False
    try:
        atomic_text(Path('/etc/systemd/system') / SERVICE, unit.read_text(), 0o644)
        run('systemctl', 'daemon-reload')
        stop_attempted = True
        run('systemctl', 'stop', SERVICE)
        removed_environment_keys = remove_retired_environment(Path('/etc/yuxi/backend.env'))
        os.replace(next_link, CURRENT)
        sync_directory(CURRENT.parent)
    except Exception:
        next_link.unlink(missing_ok=True)
        # No new backend has started here, so the database still belongs to
        # the previous process and that process can safely be resumed.
        if stop_attempted and CURRENT.resolve() == previous:
            run('systemctl', 'start', SERVICE)
        raise
    # Schema 2 removes retired credentials. Never restart a schema-1 backend
    # against this database after the new process has opened it.
    run('systemctl', 'start', SERVICE)
    health = None
    loopback = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(30):
        try:
            with loopback.open('http://127.0.0.1:8787/api/health', timeout=2) as response:
                health = json.load(response)
            if health == {'status': 'ok', 'service': 'yuxi', 'storage': 'sqlite', 'version': 2}:
                break
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    else:
        raise RuntimeError('New release health failed; keep this release and repair forward without downgrading the database')
    run('systemctl', 'is-active', '--quiet', SERVICE)
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
        after_schema = db.execute('PRAGMA user_version').fetchone()[0]
        old_cookie_column = any(row[1] == 'cookie' for row in db.execute('PRAGMA table_info(sessions)'))
        old_qr_table = db.execute("SELECT 1 FROM sqlite_schema WHERE name='qr_keys'").fetchone()
    if after_schema != 2 or old_cookie_column or old_qr_table:
        raise RuntimeError('Retired account schema was not removed')
    (STATE / 'session.key').unlink(missing_ok=True)
    backups = retired_backups()
    receipt = {'ok': True, 'source_commit': manifest['source_commit'],
               'release': str(release), 'previous_release': str(previous),
               'manifest_sha256': args.manifest_sha256,
               'schema_before': before_schema, 'schema_after': after_schema,
               'health': health, 'smoke': smoke_result,
               'removed_environment_keys': removed_environment_keys,
               'automatic_backups': backups, 'database_copy_created': False}
    print(json.dumps(receipt, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
