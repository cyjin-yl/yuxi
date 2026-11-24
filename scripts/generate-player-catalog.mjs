import { readFile, writeFile } from 'node:fs/promises';

// The original release audio is now served by the same-origin OVH backend.
// Keep its IDs separate from NetEase IDs: recordings with similar titles need
// not be the same recording, and sharing must retain the selected source.
const songs = JSON.parse(await readFile(new URL('../src/data/classic-songs.json', import.meta.url), 'utf8'));
const tracks = {};
for (const song of songs) {
  if (!/^classic-\d{2}$/.test(song.id) || tracks[song.id] || !/^[A-Za-z0-9_]+\.m4a$/.test(song.file)) {
    throw new Error('Invalid or duplicate classic song entry');
  }
  tracks[song.id] = {
    id: song.id,
    num: String(song.number).padStart(2, '0'),
    title: song.title,
    artist: song.artist,
    audioUrl: `/audio/${encodeURIComponent(song.file)}`,
    href: '/collections/#classics',
    source: 'local',
  };
}
const catalog = {
  version: 1,
  collections: [{ id: 'classic-songs', title: 'English Essentials 40', titleZh: '经典英语歌曲', kind: 'music', trackIds: Object.keys(tracks) }],
  tracks,
};
await writeFile(new URL('../public/player-catalog.json', import.meta.url), JSON.stringify(catalog) + '\n');
console.log(`Generated local catalog: ${songs.length} original recordings.`);
