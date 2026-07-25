import hashlib
import hmac
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.environ.get("HERMES_HOST", "127.0.0.1")
PORT = int(os.environ.get("HERMES_PORT", "8788"))
SECRET = os.environ["HERMES_SHARED_SECRET"].encode()
COOKIE = os.environ.get("NETEASE_COOKIE", "")
CACHE = Path(os.environ.get("HERMES_CACHE_DIR", "/var/lib/hermes/netease"))
API = "https://music.163.com"
ID = re.compile(r"^[1-9][0-9]{0,19}$")
NONCES: dict[str, int] = {}


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def netease(path: str, *, method: str = "GET", data: bytes | None = None) -> tuple[bytes, str]:
    headers = {
        "User-Agent": "Mozilla/5.0 Hermes-NetEase/1.0",
        "Referer": "https://music.163.com/",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    if COOKIE:
        headers["Cookie"] = COOKIE
    request = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read(), response.headers.get_content_type()


def signed(handler: BaseHTTPRequestHandler, path: str) -> bool:
    timestamp = handler.headers.get("X-Hermes-Timestamp", "")
    nonce = handler.headers.get("X-Hermes-Nonce", "")
    supplied = handler.headers.get("X-Hermes-Signature", "")
    try:
        now = int(time.time())
        stamp = int(timestamp)
    except ValueError:
        return False
    if abs(now - stamp) > 60 or not re.fullmatch(r"[a-f0-9]{32}", nonce):
        return False
    for key, expires in list(NONCES.items()):
        if expires < now:
            del NONCES[key]
    if nonce in NONCES:
        return False
    canonical = f"GET\n{path}\n{timestamp}\n{nonce}\n{hashlib.sha256(b'').hexdigest()}"
    expected = hmac.new(SECRET, canonical.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, supplied):
        return False
    NONCES[nonce] = now + 120
    return True


def cached_json(kind: str, resource_id: str, fetcher) -> tuple[bytes, str, bool]:
    path = CACHE / kind / f"{resource_id}.json"
    if path.exists():
        return path.read_bytes(), "application/json", True
    payload = fetcher()
    parsed = json.loads(payload)
    envelope = json.dumps({
        "fetchedAt": int(time.time()),
        "source": "netease",
        "resourceId": resource_id,
        "data": parsed,
    }, ensure_ascii=False, separators=(",", ":")).encode()
    atomic_write(path, envelope)
    return envelope, "application/json", False


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_payload(self, status: int, payload: bytes, content_type: str, cached: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Hermes-Cache", "HIT" if cached else "MISS")
        self.send_header("Cache-Control", "public, max-age=300" if cached else "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def do_GET(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if not signed(self, path):
            self.send_payload(401, b'{"error":"unauthorized"}', "application/json")
            return
        match = re.fullmatch(r"/v1/(playlist|lyrics|audio)/([0-9]+)", path)
        if not match or not ID.fullmatch(match.group(2)):
            self.send_payload(404, b'{"error":"not_found"}', "application/json")
            return
        kind, resource_id = match.groups()
        try:
            if kind == "playlist":
                payload, content_type, hit = cached_json(kind, resource_id, lambda: netease(f"/api/v6/playlist/detail?id={resource_id}")[0])
            elif kind == "lyrics":
                payload, content_type, hit = cached_json(kind, resource_id, lambda: netease(f"/api/song/lyric?id={resource_id}&lv=1&kv=1&tv=-1")[0])
            else:
                audio_path = CACHE / "audio" / f"{resource_id}.m4a"
                meta_path = CACHE / "audio" / f"{resource_id}.json"
                hit = audio_path.exists()
                if not hit:
                    form = urllib.parse.urlencode({"ids": f"[{resource_id}]", "level": "standard", "encodeType": "aac"}).encode()
                    raw, _ = netease("/api/song/enhance/player/url/v1", method="POST", data=form)
                    result = json.loads(raw).get("data", [{}])[0]
                    url = result.get("url")
                    if not url:
                        code = result.get("code", -1)
                        self.send_payload(451, json.dumps({"error": "audio_unavailable", "code": code}).encode(), "application/json")
                        return
                    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Hermes-NetEase/1.0"}), timeout=90) as response:
                        audio = response.read()
                        content_type = response.headers.get_content_type()
                    atomic_write(audio_path, audio)
                    atomic_write(meta_path, json.dumps({"fetchedAt": int(time.time()), "source": "netease", "resourceId": resource_id, "contentType": content_type, "bytes": len(audio)}).encode())
                payload, content_type = audio_path.read_bytes(), "audio/mp4"
            self.send_payload(200, payload, content_type, hit)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            payload = json.dumps({"error": "upstream_failure", "detail": str(error)}).encode()
            self.send_payload(502, payload, "application/json")

    def log_message(self, format: str, *args) -> None:
        print(f"{self.address_string()} {format % args}")


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
