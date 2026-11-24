/** Keep reading pages static; download the player only after a music action. */
import playerStyles from '../../styles/player.css?url';
import sharedStyles from '../../styles/music-shared.css?url';

const PLAY_ACTION = '[data-play-track], [data-play-netease-song], [data-play-liked], [data-play-netease-playlist], [data-play-collection], [data-netease-play]';

let loading: Promise<typeof import('./bindings')> | undefined;

function loadStyle(href: string) {
  const existing = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].find((link) => link.getAttribute('href') === href);
  if (existing) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.astroTransitionPersist = href;
    link.dataset.yuxiPlayerStyle = '1';
    link.onload = () => resolve();
    link.onerror = () => { link.remove(); reject(new Error('player_style_failed')); };
    document.head.appendChild(link);
  });
}

// Astro only persists head elements that also exist in the incoming document.
// Carry the already requested player styles forward once the player is active.
document.addEventListener('astro:before-swap', (event) => {
  const incoming = (event as Event & { newDocument: Document }).newDocument;
  if (!incoming) return;
  document.querySelectorAll<HTMLLinkElement>('link[data-yuxi-player-style]').forEach((link) => {
    if (![...incoming.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some((other) => other.getAttribute('href') === link.getAttribute('href'))) {
      incoming.head.appendChild(link.cloneNode(true));
    }
  });
});

export function loadPlayer() {
  if (!loading) {
    loading = Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../../components/PlayerShell'),
      import('./bindings'),
      loadStyle(playerStyles),
      loadStyle(sharedStyles),
    ]).then(([React, { createRoot }, { default: PlayerShell }, bindings]) => {
      const container = document.getElementById('player-root');
      if (!container) throw new Error('player_container_missing');
      createRoot(container).render(React.createElement(PlayerShell));
      bindings.setupPlayerBindings();
      return bindings;
    }).catch((error) => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}

document.addEventListener('click', async (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLElement>(PLAY_ACTION);
  if (!button || button.getAttribute('aria-busy') === 'true') return;
  event.preventDefault();
  button.setAttribute('aria-busy', 'true');
  const status = document.getElementById('player-status');
  if (status) status.textContent = '正在载入播放器…';
  try {
    const bindings = await loadPlayer();
    await bindings.playFromTarget(button);
    if (status) status.textContent = '播放器已就绪。';
  } catch {
    if (status) status.textContent = '音乐暂时无法加载，请重试。';
    button.title = '音乐暂时无法加载，请重试';
  } finally {
    button.removeAttribute('aria-busy');
  }
});
