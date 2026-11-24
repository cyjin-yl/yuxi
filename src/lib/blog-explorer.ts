import { pageNumbers } from './pagination';
import { searchExcerpt, searchHref, searchPosts, searchTerms, stateFromUrl, type SearchPost, type SearchState } from './blog-search';

const indexes = new Map<string, Promise<SearchPost[]>>();
function loadIndex(url: string): Promise<SearchPost[]> {
  let pending = indexes.get(url);
  if (!pending) {
    pending = fetch(url, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error('search_unavailable');
      const body = await response.json();
      if (body.version !== 1 || !Array.isArray(body.posts)) throw new Error('search_invalid_index');
      return body.posts as SearchPost[];
    }).catch((error) => { indexes.delete(url); throw error; });
    indexes.set(url, pending);
  }
  return pending;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function highlighted(node: HTMLElement, text: string, query: string) {
  const terms = searchTerms(query).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) { node.textContent = text; return; }
  const pattern = new RegExp(terms.sort((a, b) => b.length - a.length).join('|'), 'giu');
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    node.append(document.createTextNode(text.slice(at, match.index)), element('mark', '', match[0]));
    at = match.index! + match[0].length;
  }
  node.append(document.createTextNode(text.slice(at)));
}

function postCard(post: SearchPost, query: string): HTMLLIElement {
  const item = element('li', 'post-item');
  const link = element('a', 'post-item-link');
  link.href = `/blog/${post.id}/`;
  const title = element('div', 'post-item-title');
  highlighted(title, post.title, query);
  const meta = element('div', 'post-item-meta');
  const date = element('time', '', post.date.replace(/-/g, '/'));
  date.dateTime = post.date;
  meta.append(date);
  if (post.backfilled) meta.append(element('span', 'post-backfill-label', '整理'));
  for (const tag of post.tags) meta.append(element('span', 'tag', tag));
  link.append(title, meta);
  const excerpt = searchExcerpt(post, query);
  if (excerpt) {
    const description = element('p', 'post-item-desc');
    highlighted(description, excerpt, query);
    link.append(description);
  }
  item.append(link);
  return item;
}

function pagination(state: SearchState, total: number): HTMLElement | null {
  if (total <= 1) return null;
  const nav = element('nav', 'pagination');
  nav.setAttribute('aria-label', '搜索结果分页');
  const row = element('div', 'pagination-links');
  const control = (page: number, label: string, disabled = false) => {
    if (disabled) {
      const span = element('span', 'disabled', label);
      span.setAttribute('aria-disabled', 'true');
      return span;
    }
    const link = element('a', '', label);
    link.href = searchHref({ ...state, page });
    link.dataset.searchPage = String(page);
    return link;
  };
  row.append(control(1, '首页', state.page === 1), control(state.page - 1, '上一页', state.page === 1));
  const pages = element('ol', 'pagination-pages');
  for (const page of pageNumbers(state.page, total)) {
    const li = element('li');
    if (page === 'gap') {
      const gap = element('span', 'pagination-gap', '…');
      gap.setAttribute('aria-hidden', 'true');
      li.append(gap);
    } else {
      const link = control(page, String(page));
      link.setAttribute('aria-label', `第 ${page} 页`);
      if (page === state.page) link.setAttribute('aria-current', 'page');
      li.append(link);
    }
    pages.append(li);
  }
  row.append(pages, control(state.page + 1, '下一页', state.page === total), control(total, '末页', state.page === total));
  const details = element('div', 'pagination-details');
  details.append(element('p', 'pagination-status', `第 ${state.page} / ${total} 页`));
  const form = element('form');
  form.dataset.searchJump = '1';
  const label = element('label', '', '跳至 ');
  const input = element('input');
  input.type = 'number'; input.name = 'page'; input.min = '1'; input.max = String(total); input.step = '1'; input.value = String(state.page); input.required = true;
  input.setAttribute('aria-label', '跳到第几页');
  label.append(input, document.createTextNode(' 页'));
  const button = element('button', '', '前往');
  button.type = 'submit';
  form.append(label, button); details.append(form); nav.append(row, details);
  return nav;
}

export function mountExplorer(root: HTMLElement) {
  root.dataset.mounted = '1';
  const lifecycle = new AbortController();
  const options = { signal: lifecycle.signal };
  const form = root.querySelector<HTMLFormElement>('[data-search-form]')!;
  const query = form.elements.namedItem('q') as HTMLInputElement;
  const tag = form.elements.namedItem('tag') as HTMLSelectElement;
  const month = form.elements.namedItem('month') as HTMLSelectElement;
  const sort = form.elements.namedItem('sort') as HTMLSelectElement;
  const clear = root.querySelector<HTMLButtonElement>('[data-search-clear]')!;
  clear.hidden = false;
  const status = root.querySelector<HTMLElement>('[role="status"]')!;
  const fallback = root.querySelector<HTMLElement>('[data-search-fallback]')!;
  const output = root.querySelector<HTMLElement>('[data-search-output]')!;
  const results = root.querySelector<HTMLElement>('[data-search-results]')!;
  const pager = root.querySelector<HTMLElement>('[data-search-pagination]')!;
  let state = stateFromUrl(new URL(location.href));
  let sequence = 0;
  let timer = 0;
  let composing = false;
  let editing = false;
  function cancelPending() {
    window.clearTimeout(timer);
    sequence++;
    root.removeAttribute('aria-busy');
  }

  function fillForm() {
    query.value = state.q;
    for (const [select, value] of [[tag, state.tag], [month, state.month], [sort, state.sort]] as const) {
      if (value && ![...select.options].some((option) => option.value === value)) select.add(new Option(value, value));
      select.value = value;
    }
  }
  function fromForm(): SearchState {
    return { q: query.value.trim().slice(0, 200), tag: tag.value, month: month.value, sort: sort.value as SearchState['sort'], page: 1 };
  }
  function updateUrl(mode: 'push' | 'replace') {
    const href = searchHref(state);
    if (`${location.pathname}${location.search}` === href) return;
    history[mode === 'push' ? 'pushState' : 'replaceState']({ ...history.state }, '', href);
  }
  async function render(mode: 'push' | 'replace' | null, focus = false) {
    window.clearTimeout(timer);
    const request = ++sequence;
    if (mode) updateUrl(mode);
    root.setAttribute('aria-busy', 'true');
    status.textContent = '正在查找文章…';
    try {
      const posts = await loadIndex(root.dataset.indexUrl!);
      if (request !== sequence || lifecycle.signal.aborted || !root.isConnected) return;
      const match = searchPosts(posts, state);
      state.page = match.page;
      updateUrl('replace');
      const list = element('ul', 'post-list');
      list.append(...match.posts.map((post) => postCard(post, state.q)));
      results.replaceChildren(match.total ? list : element('p', 'search-empty', '没有找到符合条件的文章。试试更短的关键词，或清空筛选。'));
      const nav = pagination(state, match.totalPages);
      pager.replaceChildren(...(nav ? [nav] : []));
      fallback.hidden = true; output.hidden = false;
      status.textContent = match.total ? `${match.total} 篇文章 · 第 ${match.page} / ${match.totalPages} 页` : '没有匹配的文章';
      if (focus) {
        results.focus({ preventScroll: true });
        results.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    } catch {
      if (request === sequence && !lifecycle.signal.aborted) status.textContent = '搜索暂时不可用，请再试一次。下方文章可以继续阅读。';
    } finally {
      if (request === sequence) root.removeAttribute('aria-busy');
    }
  }
  const submit = () => { editing = false; state = fromForm(); void render('push'); };
  const reset = () => {
    editing = false;
    state = { q: '', tag: '', month: '', sort: 'relevance', page: 1 };
    fillForm(); void render('push'); query.focus();
  };
  function schedule() {
    if (composing) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const mode = editing ? 'replace' : 'push';
      editing = true;
      state = fromForm(); void render(mode);
    }, 120);
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); submit(); }, options);
  query.addEventListener('input', schedule, options);
  query.addEventListener('focus', () => { editing = false; }, options);
  query.addEventListener('compositionstart', () => { composing = true; }, options);
  query.addEventListener('compositionend', () => { composing = false; schedule(); }, options);
  query.addEventListener('keydown', (event) => { if (event.key === 'Escape' && query.value) { event.preventDefault(); reset(); } }, options);
  for (const select of [tag, month, sort]) select.addEventListener('change', submit, options);
  clear.addEventListener('click', reset, options);
  pager.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[data-search-page]');
    if (!link) return;
    event.preventDefault(); editing = false;
    state.page = Number(link.dataset.searchPage);
    void render('push', true);
  }, options);
  pager.addEventListener('submit', (event) => {
    const jump = event.target as HTMLFormElement;
    if (!jump.matches('[data-search-jump]')) return;
    event.preventDefault();
    if (!jump.reportValidity()) return;
    state.page = Number((jump.elements.namedItem('page') as HTMLInputElement).value);
    editing = false; void render('push', true);
  }, options);
  window.addEventListener('popstate', () => {
    cancelPending();
    if (!/^\/blog\/(?:page\/\d+\/)?$/.test(location.pathname)) return;
    state = stateFromUrl(new URL(location.href)); fillForm(); editing = false; void render(null);
  }, options);
  document.addEventListener('astro:before-preparation', cancelPending, options);
  document.addEventListener('astro:before-swap', () => { lifecycle.abort(); window.clearTimeout(timer); }, { once: true, ...options });
  if (root.dataset.edited) { editing = true; state = fromForm(); void render('push'); }
  else {
    fillForm();
    if (state.q || state.tag || state.month || state.sort !== 'relevance' || new URL(location.href).searchParams.has('page')) void render(null);
    else void loadIndex(root.dataset.indexUrl!).catch(() => {});
  }
  return { submit };
}
