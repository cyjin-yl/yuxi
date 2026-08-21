#!/usr/bin/env python3
"""
blog-pipeline/fetch-agent-history.py
Reads agent session histories, filters sensitive info, outputs candidate stories as JSON Lines.
Sources: ~/.omp/agent/history.db (SQLite), ~/.claude/history.jsonl
"""
import sqlite3, json, re, os, sys
from datetime import datetime, timezone
from pathlib import Path

OMP_DB = Path.home() / ".omp/agent/history.db"
CLAUDE_HIST = Path.home() / ".claude/history.jsonl"
OUT = Path("/tmp/blog-candidates.jsonl")

# —— Sensitive patterns to REDACT ——
SECRET_PATTERNS = [
    (r'\b(?:sk|pk)-[A-Za-z0-9_-]{20,}\b', '[REDACTED_API_KEY]'),
    (r'\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b', '[REDACTED_JWT]'),
    (r'(?i)password[\s:=]+["\']?(?!\[REDACTED)[^"\'\s]{4,}', 'password=[REDACTED]'),
    (r'(?i)token[\s:=]+["\']?(?!\[REDACTED)[^"\'\s]{8,}', 'token=[REDACTED]'),
    (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b', '[REDACTED_EMAIL]'),
    (r'\b(?:\d{1,3}\.){3}\d{1,3}\b(?!\s*$)', '[REDACTED_IP]'),
    (r'(?i)(?:github|gitlab|bitbucket)\.com/(?!ezra/)[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+', '[REDACTED_REPO]'),
    (r'(?i)-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----', '[REDACTED_PRIVATE_KEY]'),
    (r'\b(?:AKIA|ASIA|A3T|AGPA|AIDA|APKA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b', '[REDACTED_AWS_KEY]'),
]

def redact(text: str) -> str:
    for pat, repl in SECRET_PATTERNS:
        text = re.sub(pat, repl, text)
    return text

def quality_score(prompt: str) -> float:
    """Rough heuristic: longer, technical, debugging-oriented content scores higher."""
    if not prompt or len(prompt) < 30:
        return 0.0
    score = 0.0
    score += min(len(prompt) / 500, 3.0)  # up to +3
    tech_signals = ['fix', 'bug', 'error', 'traceback', 'debug', 'proxy', 'waf',
                    'docker', 'k8s', 'sqlite', 'deadlock', 'segfault', 'timeout',
                    'race condition', 'memory leak', 'oof', 'hernia', 'Dockerfile',
                    'vllm', 'ollama', 'wakeup', 'daemon', 'fs', 'netfilter', 'WAL']
    score += sum(0.8 for s in tech_signals if s.lower() in prompt.lower())
    # Boring / low-signal demotion
    boring = ['what is', 'explain', '翻译', '请写', '帮我写', 'hello', 'hi', '测试']
    score -= sum(1.5 for s in boring if s.lower() in prompt.lower())
    return round(score, 2)

def fetch_omp():
    if not OMP_DB.exists():
        return []
    con = sqlite3.connect(OMP_DB)
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT id, created_at, prompt, cwd FROM history WHERE prompt IS NOT NULL AND length(prompt) > 30 ORDER BY created_at DESC LIMIT 500").fetchall()
    results = []
    for r in rows:
        prompt = r["prompt"].strip()
        qs = quality_score(prompt)
        if qs < 0.5:
            continue
        results.append({
            "source": "omp",
            "session_id": r["id"],
            "created_at": r["created_at"],
            "timestamp": datetime.fromtimestamp(r["created_at"], tz=timezone.utc).isoformat(),
            "cwd": r["cwd"] or "",
            "prompt": redact(prompt),
            "score": qs,
        })
    return results

def fetch_claude():
    if not CLAUDE_HIST.exists():
        return []
    results = []
    with open(CLAUDE_HIST) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            display = d.get("display", "") or d.get("query", "")
            project = d.get("project", "")
            if len(display) < 30:
                continue
            qs = quality_score(display)
            if qs < 0.5:
                continue
            ts_ms = d.get("timestamp", 0)
            results.append({
                "source": "claude",
                "session_id": d.get("sessionId", f"claude-{i}"),
                "created_at": ts_ms // 1000 if ts_ms > 1e12 else ts_ms,
                "timestamp": datetime.fromtimestamp(ts_ms / 1000 if ts_ms > 1e12 else ts_ms, tz=timezone.utc).isoformat(),
                "cwd": project,
                "prompt": redact(display),
                "score": qs,
            })
    return results

def main():
    candidates = fetch_omp() + fetch_claude()
    candidates.sort(key=lambda x: (-x["score"], -x["created_at"]))
    top = candidates[:200]
    with open(OUT, "w") as f:
        for c in top:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"Wrote {len(top)} candidates to {OUT}")
    print(f"  omp: {sum(1 for c in candidates if c['source']=='omp')}")
    print(f"  claude: {sum(1 for c in candidates if c['source']=='claude')}")
    print(f"\nTop 5 by score:")
    for c in top[:5]:
        print(f"  [{c['source']} {c['score']}] {c['prompt'][:80]}")

if __name__ == "__main__":
    main()
