#!/usr/bin/env python3
"""Create a private SQLite online recovery set; never print database or key data."""

import argparse
from contextlib import closing
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import time
import uuid


BACKUP_NAME = re.compile(r"^\d{8}T\d{6}Z-[0-9a-f]{8}$")


def private_directory(path):
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        raise ValueError("backup directory must be a real directory owned by the executing user")
    if stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("backup directory must have mode 0700")


def read_key(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError("session key must be a private regular file")
        value = source.read(33)
    if len(value) != 32:
        raise ValueError("session key must contain exactly 32 bytes")
    return value


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_private(path, contents):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as destination:
        destination.write(contents)
        destination.flush()
        os.fsync(destination.fileno())


def completed_backups(root):
    found = []
    for path in root.iterdir():
        info = path.lstat()
        if not BACKUP_NAME.fullmatch(path.name) or not stat.S_ISDIR(info.st_mode):
            continue
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            continue
        manifest_path = path / "manifest.json"
        try:
            if manifest_path.is_symlink() or manifest_path.stat().st_size > 8192:
                continue
            manifest = json.loads(manifest_path.read_text())
            if (not isinstance(manifest, dict) or manifest.get("formatVersion") != 1 or manifest.get("backupId") != path.name
                    or manifest.get("complete") is not True):
                continue
            created = datetime.fromisoformat(manifest["createdAt"])
            if created.tzinfo is None:
                continue
            found.append((created, path))
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return sorted(found, key=lambda item: (item[0], item[1].name), reverse=True)


def create_backup(args):
    database = Path(args.database).absolute()
    key_file = Path(args.key_file).absolute()
    root = Path(args.backup_dir).absolute()
    if not stat.S_ISREG(database.lstat().st_mode):
        raise ValueError("source database must be a regular file, not a symlink")
    private_directory(root)
    lock_fd = os.open(root / ".backup.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "a+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "skipped", "reason": "backup_already_running"}

        key = read_key(key_file)
        created = datetime.now(timezone.utc)
        backup_id = created.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
        staging = Path(tempfile.mkdtemp(prefix=".incomplete-", dir=root))
        destination = staging / "yuxi.sqlite"
        deadline = time.monotonic() + args.max_seconds

        def progress(_status, _remaining, _total):
            if time.monotonic() > deadline:
                raise TimeoutError("online backup exceeded its time limit")

        try:
            # mode=ro still reads committed WAL data. Do not use immutable=1:
            # the source is live and may change during this operation.
            with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5)) as source:
                with closing(sqlite3.connect(destination, timeout=5)) as target:
                    source.backup(target, pages=256, progress=progress, sleep=0.05)
                    if target.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                        raise ValueError("backup database failed SQLite quick_check")
                    schema = target.execute("PRAGMA user_version").fetchone()[0]
                    # Publish a standalone database rather than a recovery set
                    # which depends on destination-side WAL/SHM files.
                    if target.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
                        raise ValueError("could not finalize standalone backup database")
            os.chmod(destination, 0o600)
            with destination.open("rb") as finalized:
                os.fsync(finalized.fileno())
            if read_key(key_file) != key:
                raise ValueError("session key changed during backup; retry after key rotation is complete")
            write_private(staging / "session.key", key)
            checksums = {name: digest(staging / name) for name in ("yuxi.sqlite", "session.key")}
            manifest = {
                "formatVersion": 1,
                "backupId": backup_id,
                "createdAt": created.isoformat(),
                "complete": True,
                "schemaVersion": schema,
                "sqliteVersion": sqlite3.sqlite_version,
                "databaseBytes": destination.stat().st_size,
                "files": checksums,
            }
            write_private(staging / "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())
            write_private(staging / "SHA256SUMS", "".join(
                f"{checksum}  {name}\n" for name, checksum in checksums.items()
            ).encode())
            sync_directory(staging)
            staging.rename(root / backup_id)
            staging = None
            sync_directory(root)

            # Failed attempts never enter retention. Only our completed private
            # directories are eligible; unrelated and partial files stay intact.
            completed = completed_backups(root)
            for _created, expired in completed[args.keep:]:
                shutil.rmtree(expired)
            sync_directory(root)
            return {"status": "ok", "backupId": backup_id,
                    "retained": min(len(completed), args.keep),
                    "pruned": max(0, len(completed) - args.keep)}
        finally:
            if staging is not None:
                shutil.rmtree(staging)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default=os.environ.get("YUXI_DB", "/var/lib/yuxi/yuxi.sqlite"))
    parser.add_argument("--key-file", default=os.environ.get("YUXI_KEY_FILE", "/var/lib/yuxi/session.key"))
    parser.add_argument("--backup-dir", default=os.environ.get("YUXI_BACKUP_DIR", "/var/backups/yuxi"))
    parser.add_argument("--keep", type=int, choices=(7, 14), default=os.environ.get("YUXI_BACKUP_KEEP", "14"))
    parser.add_argument("--max-seconds", type=int, default=300)
    args = parser.parse_args()
    if args.keep not in (7, 14):
        parser.error("--keep / YUXI_BACKUP_KEEP must be 7 or 14")
    if not 1 <= args.max_seconds <= 300:
        parser.error("--max-seconds must be between 1 and 300")
    try:
        print(json.dumps(create_backup(args)))
    except (OSError, sqlite3.Error, ValueError, TimeoutError) as error:
        print(f"yuxi backup failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
