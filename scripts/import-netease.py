#!/usr/bin/env python3
"""Import an authorized NetEase playlist through Worker -> Hermes.

Writes immutable source artifacts and normalized line-timed lyric JSON. Audio and
NetEase credentials never flow directly from this command to NetEase.
"""
import argparse
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

LRC = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)")


def request(base: str, token: str, kind: str, resource_id: int) -> bytes:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/netease/{kind}/{resource_id}",
        headers={"Authorization": f"Bearer {token}", "User-Agent": "yuxi-import/1.0"},
    )
    with urllib.request.urlopen(req, timeout=180) as response:
        return response.read()


def timed_lines(lrc: str) -> list[dict]:
    lines = []
    for raw in lrc.splitlines():
        match = LRC.match(raw)
        if not match:
            continue
        minute, second, fraction, text = match.groups()
        millis = int((fraction or "0").ljust(3, "0")[:3])
        lines.append({"timeMs": (int(minute) * 60 + int(second)) * 1000 + millis, "text": text.strip()})
    return sorted(lines, key=lambda line: line["timeMs"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("playlist_id", type=int)
    parser.add_argument("--worker", default=os.environ.get("NETEASE_WORKER_URL"))
    parser.add_argument("--token", default=os.environ.get("NETEASE_IMPORT_TOKEN"))
    parser.add_argument("--output", type=Path, default=Path(".netease-imports"))
    args = parser.parse_args()
    if not args.worker or not args.token:
        parser.error("--worker/NETEASE_WORKER_URL and --token/NETEASE_IMPORT_TOKEN are required")

    playlist_raw = request(args.worker, args.token, "playlist", args.playlist_id)
    envelope = json.loads(playlist_raw)
    playlist = envelope["data"].get("playlist") or envelope["data"].get("result")
    if not playlist or not isinstance(playlist.get("tracks"), list):
        raise RuntimeError("NetEase response did not contain playlist.tracks")

    root = args.output / str(args.playlist_id)
    (root / "lyrics").mkdir(parents=True, exist_ok=True)
    (root / "audio").mkdir(parents=True, exist_ok=True)
    (root / "playlist.json").write_bytes(playlist_raw)
    summary = []
    for track in playlist["tracks"]:
        track_id = int(track["id"])
        lyric_raw = request(args.worker, args.token, "lyrics", track_id)
        lyric = json.loads(lyric_raw)
        lyric_data = lyric["data"]
        original = lyric_data.get("lrc", {}).get("lyric", "")
        translated = lyric_data.get("tlyric", {}).get("lyric", "")
        normalized = {
            "trackId": track_id,
            "name": track.get("name", ""),
            "artists": [artist.get("name", "") for artist in track.get("ar", track.get("artists", []))],
            "lines": timed_lines(original),
            "translationLines": timed_lines(translated),
        }
        (root / "lyrics" / f"{track_id}.source.json").write_bytes(lyric_raw)
        (root / "lyrics" / f"{track_id}.json").write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n")
        try:
            audio = request(args.worker, args.token, "audio", track_id)
            (root / "audio" / f"{track_id}.m4a").write_bytes(audio)
            status = "cached"
        except urllib.error.HTTPError as error:
            status = f"unavailable:{error.code}"
        summary.append({"id": track_id, "name": track.get("name", ""), "audio": status})
        print(f"{track_id}: {track.get('name', '')} [{status}]")
    (root / "import-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
