type Explorer = { submit(): void };

function prepareExplorer() {
  const root = document.querySelector<HTMLElement>('[data-blog-explorer]');
  if (!root || root.dataset.loaderReady) return;
  root.dataset.loaderReady = '1';
  const form = root.querySelector<HTMLFormElement>('[data-search-form]')!;
  form.hidden = false;
  let loading: Promise<Explorer> | undefined;
  function activate() {
    return loading ??= import('./blog-explorer').then(({ mountExplorer }) => root.isConnected ? mountExplorer(root) : { submit() {} }).catch((error) => {
      loading = undefined;
      if (root.isConnected) root.querySelector<HTMLElement>('[role="status"]')!.textContent = '搜索暂时无法加载，请再试一次。下方文章可以继续阅读。';
      throw error;
    });
  }
  form.addEventListener('focusin', () => { void activate().catch(() => {}); });
  for (const event of ['input', 'change']) form.addEventListener(event, () => {
    root.dataset.edited = '1';
    void activate().catch(() => {});
  });
  form.addEventListener('submit', (event) => {
    if (root.dataset.mounted) return;
    event.preventDefault();
    root.dataset.edited = '1';
    void activate().catch(() => {});
  });
  const params = new URL(location.href).searchParams;
  if (['q', 'tag', 'month', 'sort', 'page'].some((name) => params.has(name))) void activate().catch(() => {});
}

prepareExplorer();
document.addEventListener('astro:page-load', prepareExplorer);
