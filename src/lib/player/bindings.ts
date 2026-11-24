import { getPlayer } from './store';

let subscribed = false;

function updateBodyPlayerState() {
  document.body.classList.toggle('has-player', !!getPlayer().track());
}

/** Called by the lightweight delegated loader after the visitor presses play. */
export async function playFromTarget(button: HTMLElement) {
  const player = getPlayer();
  await player.init();

  if (button.hasAttribute('data-netease-play')) {
    const id = button.dataset.id;
    if (!id) return;
    if (button.dataset.kind === 'playlist') {
      await player.loadNeteasePlaylist(id);
      if (player.getSnapshot().expand === 'mini') player.setExpand('sheet');
      void player.play();
    } else {
      await player.playNeteaseSong({ id, title: button.dataset.title ?? '', artist: button.dataset.subtitle, coverUrl: button.dataset.cover });
    }
  } else if (button.hasAttribute('data-play-track')) {
    const id = button.dataset.playTrack;
    if (!id) return;
    await player.playTrack(id, button.dataset.collection);
    const time = Number.parseFloat(button.dataset.seek ?? '');
    if (Number.isFinite(time)) player.seek(time, { play: true });
  } else if (button.hasAttribute('data-play-netease-song')) {
    await player.playNeteaseSong({ id: button.dataset.playNeteaseSong ?? '', title: button.dataset.title ?? '', artist: button.dataset.artist, coverUrl: button.dataset.cover });
  } else if (button.hasAttribute('data-play-liked')) {
    await player.playLikedCollection();
  } else if (button.hasAttribute('data-play-netease-playlist')) {
    const id = button.dataset.playNeteasePlaylist;
    if (id) await player.loadNeteasePlaylist(id);
  } else if (button.hasAttribute('data-play-netease')) {
    await player.loadNeteaseCurrent();
  } else if (button.hasAttribute('data-play-collection')) {
    const id = button.dataset.playCollection;
    if (id) await player.playCollection(id, button.dataset.start);
  }
  updateBodyPlayerState();
}

export function setupPlayerBindings() {
  if (subscribed) return;
  subscribed = true;
  getPlayer().subscribe(updateBodyPlayerState);
  document.addEventListener('astro:after-swap', updateBodyPlayerState);
  document.addEventListener('astro:page-load', updateBodyPlayerState);
}
