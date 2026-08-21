const api = require('NeteaseCloudMusicApi');
const fs = require('fs');

// The user's exact 40 classic English learning songs (mirrors public/player-catalog.json).
// [title, searchHint] — hint is the query; artist is used for preference when present.
const requests = [
  ['Yesterday Once More', 'Yesterday Once More Carpenters', 'carpenters'],
  ['Hey Jude', 'Hey Jude Beatles', 'beatles'],
  ['My Heart Will Go On', 'My Heart Will Go On Celine Dion', 'dion'],
  ['Auld Lang Syne', 'Auld Lang Syne', ''],
  ['Right Here Waiting', 'Right Here Waiting Richard Marx', 'marx'],
  ['Do-Re-Mi', 'Do-Re-Mi Sound of Music', ''],
  ['Say You Say Me', 'Say You Say Me Lionel Richie', 'richie'],
  ['Red River Valley', 'Red River Valley', ''],
  ['Take Me to Your Heart', 'Take Me to Your Heart Michael Learns to Rock', 'learns'],
  ['Turkey in the Straw', 'Turkey in the Straw', ''],
  ['Seasons in the Sun', 'Seasons in the Sun Terry Jacks', 'jacks'],
  ['Big Big World', 'Big Big World Emilia', 'emilia'],
  ['Scarborough Fair', 'Scarborough Fair Simon Garfunkel', 'garfunkel'],
  ['Take Me Home Country Roads', 'Take Me Home Country Roads John Denver', 'denver'],
  ['Lemon Tree', 'Lemon Tree Fools Garden', 'garden'],
  ['Happy Days Are Here Again', 'Happy Days Are Here Again', ''],
  ['You Raise Me Up', 'You Raise Me Up Secret Garden', 'garden'],
  ['My Love', 'My Love Westlife', 'westlife'],
  ['Mockingbird Hill', 'Mockingbird Hill', ''],
  ['Days of My Past', 'Days of My Past', ''],
  ['Can You Feel the Love Tonight', 'Can You Feel the Love Tonight Elton John', 'elton'],
  ['Rhythm of the Rain', 'Rhythm of the Rain Cascades', 'cascades'],
  ["Mother's Day Song", "Mother's Day Song", ''],
  ['Heal the World', 'Heal the World Michael Jackson', 'jackson'],
  ['I Believe I Can Fly', 'I Believe I Can Fly', 'kelly'],
  ['Memory', 'Memory Cats Andrew Lloyd Webber', ''],
  ['Try Everything', 'Try Everything Shakira', 'shakira'],
  ["I've Been Working on the Railroad", "I've Been Working on the Railroad", ''],
  ['Moon River', 'Moon River', ''],
  ['The Sound of Silence', 'The Sound of Silence Simon Garfunkel', 'garfunkel'],
  ['Dream It Possible', 'Dream It Possible Delacey', 'delacey'],
  ['Bridge over Troubled Water', 'Bridge over Troubled Water Simon Garfunkel', 'garfunkel'],
  ['What a Wonderful World', 'What a Wonderful World Louis Armstrong', 'armstrong'],
  ['Somewhere over the Rainbow', 'Somewhere over the Rainbow Judy Garland', 'garland'],
  ['Lean on Me', 'Lean on Me Bill Withers', 'withers'],
  ['Stand by Me', 'Stand by Me Ben King', 'king'],
  ["That's What Friends Are for", "That's What Friends Are for Dionne Warwick", 'warwick'],
  ["You've Got a Friend in Me", "You've Got a Friend in Me Randy Newman", 'newman'],
  ['When You Wish upon a Star', 'When You Wish upon a Star', ''],
  ["How Far I'll Go", "How Far I'll Go Moana", ''],
];

const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const persist = (value) => {
  const text = JSON.stringify(value, null, 2);
  fs.writeFileSync('/tmp/yuxi-english-playlist.json', text);
  fs.mkdirSync('src/data', { recursive: true });
  fs.writeFileSync('src/data/english-playlist.json', text);
  process.stdout.write(text + '\n');
};

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', async () => {
  try {
    const cookie = input.trim();
    if (!cookie.startsWith('MUSIC_U=')) throw new Error('Expected MUSIC_U cookie on stdin');
    const status = await api.login_status({ cookie, proxy });
    const uid = status.body?.data?.profile?.userId;
    if (!uid) throw new Error('NetEase cookie is not authenticated');

    // Remove any previously created English Essentials 40 playlists (wrong song set).
    const existing = await api.user_playlist({ uid: String(uid), limit: 1000, cookie, proxy });
    const stale = (existing.body?.playlist || []).filter((item) => item.name.startsWith('English Essentials 40 —'));
    for (const item of stale) {
      await api.playlist_delete({ id: String(item.id), cookie, proxy });
      process.stderr.write(`deleted stale playlist ${item.id} ${item.name}\n`);
    }

    const selected = await Promise.all(
      requests.map(async ([title, hint, artistNeedle]) => {
        const result = await api.cloudsearch({ keywords: hint, type: 1, limit: 20, cookie, proxy });
        const songs = result.body?.result?.songs || [];
        const titleNeedle = normalize(title);
        const titleMatch = (song) => {
          const name = normalize(song.name || '');
          return name.includes(titleNeedle) || titleNeedle.includes(name);
        };
        const byArtist = songs.find(
          (song) =>
            titleMatch(song) &&
            artistNeedle &&
            (song.ar || []).some((a) => normalize(a.name).includes(artistNeedle)),
        );
        const byTitle = songs.find(titleMatch);
        const song = byArtist || byTitle || songs[0];
        if (!song) throw new Error(`No match for ${title}`);
        return {
          id: String(song.id),
          requested: title,
          matched: `${song.name} — ${(song.ar || []).map((a) => a.name).join(', ')}`,
        };
      }),
    );
    if (new Set(selected.map((song) => song.id)).size !== 40) {
      const seen = new Set();
      const dupes = selected.filter((s) => (seen.has(s.id) ? true : (seen.add(s.id), false)));
      throw new Error(`Duplicate tracks: ${dupes.map((d) => d.requested).join(', ')}`);
    }

    const name = `English Essentials 40 — ${new Date().toISOString().slice(0, 10)}`;
    const created = await api.playlist_create({ name, privacy: 10, cookie, proxy });
    const pid = created.body?.id;
    if (!pid) throw new Error(JSON.stringify(created.body));

    // NetEase shows the newest addition on top, so add in reverse catalog
    // order — the playlist then displays track 1 first, matching the blog.
    const ordered = selected.map((song) => song.id).reverse();
    const added = await api.playlist_tracks({
      op: 'add',
      pid: String(pid),
      tracks: ordered.join(','),
      cookie,
      proxy,
    });
    const code = added.body?.code ?? added.body?.body?.code;
    if (code !== 200) throw new Error(JSON.stringify(added.body));

    const verified = await api.playlist_detail({ id: String(pid), s: 0, cookie, proxy });
    const count = verified.body?.playlist?.trackIds?.length;
    persist({ uid, playlistId: String(pid), name, count, tracks: selected });
    process.exit(count === 40 ? 0 : 2);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
  }
});
