import { neteaseHttps, neteaseThumb } from './cover';
import { listLikedTracks } from './player/likes';
import { neteaseSongToTrack, publicPlaylistId, type NeteaseSong } from './player/netease';

interface MusicCard {
  action: 'song' | 'playlist' | 'liked';
  id?: string;
  title: string;
  artist?: string;
  coverUrl?: string;
  detail?: string;
}

function card(item: MusicCard): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'netease-card';
  button.setAttribute('aria-label', `播放${item.action === 'playlist' ? '歌单 ' : ' '}${item.title}`);
  if (item.action === 'liked') button.dataset.playLiked = '1';
  if (item.action === 'playlist') button.dataset.playNeteasePlaylist = item.id ?? '';
  if (item.action === 'song') {
    button.dataset.playNeteaseSong = item.id ?? '';
    button.dataset.title = item.title;
    button.dataset.artist = item.artist ?? '';
    button.dataset.cover = item.coverUrl ?? '';
  }
  const cover = document.createElement('span');
  cover.className = 'netease-cover-wrap';
  const src = item.coverUrl ? neteaseHttps(item.coverUrl) : '';
  if (/^https:\/\//.test(src) || /^\/(?!\/)/.test(src)) {
    const img = document.createElement('img');
    img.className = 'netease-cover';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 240;
    img.height = 240;
    img.src = neteaseThumb(src, 240) ?? src;
    cover.append(img);
  } else {
    cover.classList.add('music-cover-empty');
    cover.setAttribute('aria-hidden', 'true');
    cover.textContent = item.action === 'liked' ? '♥' : '♫';
  }
  const title = document.createElement('span');
  title.className = 'netease-title-marquee';
  const text = document.createElement('span');
  text.className = 'netease-title-text';
  text.textContent = item.title;
  title.append(text);
  button.append(cover, title);
  if (item.detail || item.artist) {
    const detail = document.createElement('span');
    detail.className = 'local-likes-sub';
    detail.textContent = item.detail ?? item.artist ?? '';
    button.append(detail);
  }
  requestAnimationFrame(() => {
    if (!button.isConnected) return;
    const overflow = text.scrollWidth - title.clientWidth;
    if (overflow <= 4) return;
    text.style.setProperty('--netease-marquee-distance', `${overflow}px`);
    text.style.setProperty('--netease-marquee-duration', `${Math.max(6, overflow / 36)}s`);
    text.dataset.overflow = '1';
  });
  return button;
}

/** Collections can be browsed before the audio player is downloaded. */
export function setupMusicBrowser(): void {
  const root = document.getElementById('music-browser');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  const lifecycle = new AbortController();
  const options = { signal: lifecycle.signal };
  document.addEventListener('astro:before-swap', () => lifecycle.abort(), { once: true, ...options });
  const likesSection = document.getElementById('local-likes-section');
  const likesGrid = document.getElementById('local-likes-grid');
  const likes = listLikedTracks();
  if (likesSection && likesGrid) {
    likesSection.hidden = likes.length === 0;
    likesGrid.replaceChildren(...(likes.length ? [card({ action: 'liked', title: '我喜欢的音乐', coverUrl: likes[0].coverUrl, detail: `${likes.length} 首` })] : []));
  }
  const searchForm = document.getElementById('music-search-form') as HTMLFormElement;
  const searchInput = document.getElementById('music-search-query') as HTMLInputElement;
  const searchButton = searchForm.querySelector<HTMLButtonElement>('button')!;
  const searchStatus = document.getElementById('music-search-status')!;
  const searchResults = document.getElementById('music-search-results')!;
  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query || searchButton.disabled) return;
    searchButton.disabled = true;
    searchStatus.textContent = '正在搜索…';
    searchResults.replaceChildren();
    try {
      const response = await fetch(`/netease/search?q=${encodeURIComponent(query)}&limit=30`, options);
      if (!response.ok) throw new Error('search_failed');
      const body = await response.json() as { result?: { songs?: NeteaseSong[] } };
      if (lifecycle.signal.aborted) return;
      const tracks = (body.result?.songs ?? []).map(neteaseSongToTrack);
      searchResults.replaceChildren(...tracks.map((track) => card({ action: 'song', ...track })));
      searchStatus.textContent = tracks.length ? `找到 ${tracks.length} 首歌曲` : '没找到结果，换个关键词试试。';
    } catch {
      if (!lifecycle.signal.aborted) searchStatus.textContent = '搜索暂时不可用，请稍后再试。';
    } finally { searchButton.disabled = false; }
  }, options);
  const playlistForm = document.getElementById('public-playlist-form') as HTMLFormElement;
  const playlistInput = document.getElementById('public-playlist-input') as HTMLInputElement;
  const playlistButton = playlistForm.querySelector<HTMLButtonElement>('button')!;
  const playlistStatus = document.getElementById('public-playlist-status')!;
  const playlistResult = document.getElementById('public-playlist-result')!;
  playlistForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (playlistButton.disabled) return;
    const id = publicPlaylistId(playlistInput.value);
    if (!id) {
      playlistStatus.textContent = '请粘贴网易云歌单链接，或填写歌单的数字 ID。';
      playlistInput.focus();
      return;
    }
    playlistButton.disabled = true;
    playlistStatus.textContent = '正在打开歌单…';
    try {
      const response = await fetch(`/netease/playlist/${id}?withFirst=1`, options);
      if (!response.ok) throw new Error('playlist_failed');
      const body = await response.json() as { playlist?: { name?: string; coverImgUrl?: string; trackCount?: number } };
      if (!body.playlist) throw new Error('playlist_missing');
      if (lifecycle.signal.aborted) return;
      const playlist = body.playlist;
      playlistResult.replaceChildren(card({ action: 'playlist', id, title: playlist.name || '公开歌单', coverUrl: playlist.coverImgUrl, detail: playlist.trackCount ? `${playlist.trackCount} 首` : '网易云公开歌单' }));
      playlistStatus.textContent = '点开歌单就能播放。';
    } catch {
      if (!lifecycle.signal.aborted) playlistStatus.textContent = '访客暂时读不到这张歌单。可以换一张公开歌单，或搜索歌曲。';
    } finally { playlistButton.disabled = false; }
  }, options);
}
