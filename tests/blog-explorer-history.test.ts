import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountExplorer } from '../src/lib/blog-explorer';

class Field extends EventTarget {
  value = '';
  hidden = false;
  options = [{ value: '' }, { value: 'relevance' }];
  focus() { this.dispatchEvent(new Event('focus')); }
}

let index = 0;
function fixture(path = '/blog/', earlyQuery = '') {
  const fields = { q: new Field(), tag: new Field(), month: new Field(), sort: new Field() };
  fields.sort.value = 'relevance';
  const form = new EventTarget() as EventTarget & { elements: { namedItem(name: string): Field } };
  form.elements = { namedItem: (name) => fields[name as keyof typeof fields] };
  const clear = new Field();
  const pager = new EventTarget();
  const nodes = { '[data-search-form]': form, '[data-search-clear]': clear, '[role="status"]': {}, '[data-search-fallback]': {}, '[data-search-output]': {}, '[data-search-results]': {}, '[data-search-pagination]': pager };
  const root = {
    dataset: { indexUrl: `/index-${++index}.json`, ...(earlyQuery ? { edited: '1' } : {}) }, isConnected: true,
    querySelector: (selector: string) => nodes[selector as keyof typeof nodes],
    setAttribute() {}, removeAttribute() {},
  };
  const page = new EventTarget();
  const browser = Object.assign(new EventTarget(), { clearTimeout, setTimeout });
  const history = {
    state: { index: 7, custom: 'retained' },
    pushState: vi.fn((state, _title, href) => { history.state = state; vi.stubGlobal('location', new URL(href, 'https://yvxi.cyjin.dev')); }),
    replaceState: vi.fn((state, _title, href) => { history.state = state; vi.stubGlobal('location', new URL(href, 'https://yvxi.cyjin.dev')); }),
  };
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', page);
  vi.stubGlobal('history', history);
  vi.stubGlobal('location', new URL(path, 'https://yvxi.cyjin.dev'));
  // Keep the index pending: URL changes must work while the first download is in flight.
  let resolveIndex: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveIndex = resolve; })));
  fields.q.value = earlyQuery;
  mountExplorer(root as unknown as HTMLElement);
  const type = (value: string) => { fields.q.value = value; fields.q.dispatchEvent(new Event('input')); };
  return { fields, type, history, page, browser, clear, respondIndex: () => resolveIndex(Response.json({ version: 1, posts: [] })) };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('search navigation lifecycle', () => {
  it('keeps the original page in history when several keystrokes arrive before debounce', () => {
    const app = fixture('/blog/page/3/');
    app.type('s'); vi.advanceTimersByTime(40);
    app.type('sq'); vi.advanceTimersByTime(40);
    app.type('sqlite'); vi.advanceTimersByTime(120);
    expect(app.history.pushState).toHaveBeenCalledTimes(1);
    expect(app.history.replaceState).not.toHaveBeenCalled();
    expect(location.pathname + location.search).toBe('/blog/?q=sqlite');
    expect(app.history.state).toEqual({ index: 7, custom: 'retained' });
    app.type('sqlite wal'); vi.advanceTimersByTime(120);
    expect(app.history.pushState).toHaveBeenCalledTimes(1);
    expect(app.history.replaceState).toHaveBeenCalledTimes(1);
  });

  it('restores the query on Back and cancels a pending edit', () => {
    const app = fixture('/blog/?q=sqlite');
    app.type('uncommitted');
    vi.stubGlobal('location', new URL('https://yvxi.cyjin.dev/blog/page/2/'));
    app.browser.dispatchEvent(new Event('popstate'));
    vi.advanceTimersByTime(200);
    expect(app.fields.q.value).toBe('');
    expect(app.history.pushState).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/blog/page/2/');
  });

  it('keeps preloaded input in the same typing history entry', () => {
    const app = fixture('/blog/', 's');
    app.type('sqlite'); vi.advanceTimersByTime(120);
    expect(app.history.pushState).toHaveBeenCalledTimes(1);
    expect(app.history.replaceState).toHaveBeenCalledTimes(1);
    expect(location.search).toBe('?q=sqlite');
  });

  it('cannot rewrite a non-blog Back destination while Astro is fetching it', async () => {
    const app = fixture('/blog/?q=sqlite');
    app.type('uncommitted');
    vi.stubGlobal('location', new URL('https://yvxi.cyjin.dev/about/'));
    app.browser.dispatchEvent(new Event('popstate'));
    app.respondIndex();
    await vi.advanceTimersByTimeAsync(200);
    expect(app.history.pushState).not.toHaveBeenCalled();
    expect(app.history.replaceState).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/about/');
  });

  it('cancels pending search work as soon as another Astro navigation starts', async () => {
    const app = fixture('/blog/?q=sqlite');
    app.type('uncommitted');
    app.page.dispatchEvent(new Event('astro:before-preparation'));
    app.respondIndex();
    await vi.advanceTimersByTimeAsync(200);
    expect(app.history.pushState).not.toHaveBeenCalled();
    expect(app.history.replaceState).not.toHaveBeenCalled();
  });

  it('waits for composition and cancels listeners and timers when leaving the page', () => {
    const app = fixture();
    app.fields.q.dispatchEvent(new Event('compositionstart'));
    app.type('中文'); vi.advanceTimersByTime(200);
    expect(app.history.pushState).not.toHaveBeenCalled();
    app.fields.q.dispatchEvent(new Event('compositionend'));
    vi.advanceTimersByTime(120);
    expect(app.history.pushState).toHaveBeenCalledTimes(1);
    app.type('待取消');
    app.page.dispatchEvent(new Event('astro:before-swap'));
    vi.advanceTimersByTime(200);
    app.type('已经离开'); vi.advanceTimersByTime(200);
    expect(app.history.replaceState).not.toHaveBeenCalled();
    expect(app.history.pushState).toHaveBeenCalledTimes(1);
  });
});
