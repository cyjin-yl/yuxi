#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const api = require('NeteaseCloudMusicApi');

const root = path.resolve(__dirname, '..');
const cookieFile = process.env.NETEASE_COOKIE_FILE || '/home/ezra/.hermes/cache/documents/doc_8e7100145464_music.163.com_cookies.json';
const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
const cookie = cookies.filter(c => ['music.163.com', '163.com'].includes(String(c.domain).replace(/^\./, ''))).map(c => `${c.name}=${c.value}`).join('; ');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/player-catalog.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/songs/track-meta.json'), 'utf8'));
const out = path.join(root, '.netease-imports', '40-classic-english-songs.matches.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = value => new Set(norm(value).split(' ').filter(Boolean));
function overlap(a, b) { const aa=tokens(a), bb=tokens(b); if(!aa.size||!bb.size)return 0; return [...aa].filter(x=>bb.has(x)).length / Math.max(aa.size, bb.size); }
function score(title, artist, song) {
  const songArtists = (song.ar || song.artists || []).map(a => a.name).join(' ');
  const titleScore = norm(song.name) === norm(title) ? 1 : overlap(title, song.name);
  const artistScore = artist ? overlap(artist, songArtists) : 0;
  return Math.round((titleScore * .82 + artistScore * .18) * 1000) / 1000;
}
(async () => {
  const results = [];
  for (const [slug, track] of Object.entries(catalog.tracks)) {
    const details = meta[slug] || {};
    const title = track.title;
    const artist = details.artist || '';
    const query = [title, artist].filter(Boolean).join(' ');
    const response = await api.cloudsearch({ keywords: query, type: 1, limit: 8, cookie });
    const songs = response.body?.result?.songs || [];
    const candidates = songs.map(song => ({
      id: song.id,
      name: song.name,
      artists: (song.ar || song.artists || []).map(a => a.name),
      album: (song.al || song.album || {}).name || '',
      cover: (song.al || song.album || {}).picUrl || '',
      durationMs: song.dt || song.duration || 0,
      score: score(title, artist, song),
    })).sort((a,b) => b.score-a.score);
    const top = candidates[0] || null;
    const confidence = !top ? 'none' : top.score >= .92 ? 'high' : top.score >= .72 ? 'review' : 'low';
    results.push({ slug, title, artist, query, confidence, selected: confidence === 'high' ? top.id : null, candidates });
    console.log(`${String(results.length).padStart(2,'0')}/40 ${title}: ${top ? `${top.name} / ${top.artists.join(', ')} (${top.score})` : 'no result'} [${confidence}]`);
    await sleep(700);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2) + '\n');
  console.log(`Wrote ${out}`);
})().catch(error => { console.error(error.status || error.message); process.exit(1); });
