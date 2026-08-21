import { getPlayer } from './store';

let wired = false;
let subscribed = false;

function updateBodyPlayerState() {
  const player = getPlayer();
  document.body.classList.toggle('has-player', !!player.track());
}

function initPlayer() {
  const player = getPlayer();
  void player.init().then(updateBodyPlayerState);
  return player;
}

function handleClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const trackBtn = target.closest<HTMLElement>('[data-play-track]');
  if (trackBtn) {
    const player = initPlayer();
    const id = trackBtn.getAttribute('data-play-track');
    const col = trackBtn.getAttribute('data-collection') || undefined;
    const seekRaw = trackBtn.getAttribute('data-seek');
    if (!id) return;
    player.playTrack(id, col);
    document.body.classList.add('has-player');
    if (seekRaw != null) {
      const targetTime = Number.parseFloat(seekRaw);
      if (Number.isFinite(targetTime)) {
        window.setTimeout(() => player.seek(targetTime, { play: true }), 80);
        window.setTimeout(() => player.seek(targetTime, { play: true }), 350);
      }
    }
    return;
  }

  const songBtn = target.closest<HTMLElement>('[data-play-netease-song]');
  if (songBtn) {
    const player = initPlayer();
    player.playNeteaseSong({
      id: songBtn.getAttribute('data-play-netease-song') || '',
      title: songBtn.getAttribute('data-title') || '',
      artist: songBtn.getAttribute('data-artist') || undefined,
      coverUrl: songBtn.getAttribute('data-cover') || undefined,
    });
    document.body.classList.add('has-player');
    return;
  }


  const likedBtn = target.closest<HTMLElement>('[data-play-liked]');
  if (likedBtn) {
    const player = initPlayer();
    player.playLikedCollection();
    document.body.classList.add('has-player');
    return;
  }
  const playlistBtn = target.closest<HTMLElement>('[data-play-netease-playlist]');
  if (playlistBtn) {
    const player = initPlayer();
    const id = playlistBtn.getAttribute('data-play-netease-playlist');
    if (!id) return;
    playlistBtn.setAttribute('disabled', '');
    player
      .loadNeteasePlaylist(id)
      .then(() => document.body.classList.add('has-player'))
      .catch(() => {
        /* leave enabled for retry */
      })
      .finally(() => playlistBtn.removeAttribute('disabled'));
    return;
  }

  const neteaseBtn = target.closest<HTMLElement>('[data-play-netease]');
  if (neteaseBtn) {
    const player = initPlayer();
    neteaseBtn.setAttribute('disabled', '');
    player
      .loadNeteaseCurrent()
      .then(() => document.body.classList.add('has-player'))
      .catch(() => {
        /* leave the button enabled so the visitor can retry */
      })
      .finally(() => neteaseBtn.removeAttribute('disabled'));
    return;
  }

  const collectionBtn = target.closest<HTMLElement>('[data-play-collection]');
  if (collectionBtn) {
    const player = initPlayer();
    const id = collectionBtn.getAttribute('data-play-collection');
    const start = collectionBtn.getAttribute('data-start') || undefined;
    if (!id) return;
    player.playCollection(id, start);
    document.body.classList.add('has-player');
  }
}

export function setupPlayerBindings() {
  if (typeof document === 'undefined') return;
  const player = initPlayer();

  if (!subscribed) {
    subscribed = true;
    player.subscribe(updateBodyPlayerState);
  }

  if (!wired) {
    wired = true;
    document.addEventListener('click', handleClick);
    document.addEventListener('astro:after-swap', updateBodyPlayerState);
    document.addEventListener('astro:page-load', updateBodyPlayerState);
  }
}

setupPlayerBindings();
