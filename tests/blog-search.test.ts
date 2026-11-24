import { describe, expect, it } from 'vitest';
import { pageNumbers } from '../src/lib/pagination';
import { searchPosts, searchHref, stateFromUrl, searchableText, searchExcerpt, searchTerms, type SearchPost, type SearchState } from '../src/lib/blog-search';

const state: SearchState = { q: '', tag: '', month: '', sort: 'relevance', page: 1 };
const post = (id: string, extra: Partial<SearchPost> = {}): SearchPost => ({ id, title: '笔记', description: '', tags: [], date: '2026-11-24', backfilled: false, body: '日常记录', ...extra });

describe('full archive search', () => {
  it('finds body text beyond the first static page', () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(String(i), { body: i === 27 ? '末页里的 SQLite checkpoint 记录' : '普通笔记' }));
    expect(searchPosts(posts, { ...state, q: 'sqlite checkpoint' }).posts.map((item) => item.id)).toEqual(['27']);
  });

  it('ranks titles and exact tags ahead of summaries and body-only matches', () => {
    const posts = [post('body', { body: 'SQLite '.repeat(50) }), post('summary', { description: 'SQLite 的持久化' }), post('tag', { tags: ['sqlite'] }), post('title', { title: 'SQLite 持久化' })];
    expect(searchPosts(posts, { ...state, q: 'sqlite' }).posts.map((item) => item.id)).toEqual(['title', 'tag', 'summary', 'body']);
  });

  it('combines all query terms, a tag and a month', () => {
    const posts = [post('match', { title: '性能测试', tags: ['数据库'], body: 'SQLite WAL' }), post('wrong-tag', { title: '性能测试', body: 'SQLite WAL' }), post('wrong-month', { title: '性能测试', tags: ['数据库'], date: '2026-10-10', body: 'SQLite WAL' }), post('missing-term', { tags: ['数据库'], body: 'SQLite' })];
    expect(searchPosts(posts, { ...state, q: 'sqlite wal', tag: '数据库', month: '2026-11' }).posts.map((item) => item.id)).toEqual(['match']);
  });

  it('sorts by date and clamps page numbers after filtering', () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(String(i), { date: `2026-11-${String(30 - i).padStart(2, '0')}`, tags: i === 0 ? ['唯一'] : [] }));
    const last = searchPosts(posts, { ...state, page: 999 });
    expect(last).toMatchObject({ total: 30, totalPages: 3, page: 3 });
    expect(last.posts).toHaveLength(6);
    expect(searchPosts(posts, { ...state, sort: 'oldest' }).posts[0].id).toBe('29');
    expect(searchPosts(posts, { ...state, tag: '唯一', page: 3 })).toMatchObject({ total: 1, totalPages: 1, page: 1 });
    expect(searchPosts(posts, { ...state, q: '没有的内容', page: 2 })).toMatchObject({ posts: [], total: 0, totalPages: 1, page: 1 });
  });

  it('normalizes full-width text without losing technical punctuation', () => {
    expect(searchTerms('Ｃ＋＋  SQLite，WAL')).toEqual(['c++', 'sqlite', 'wal']);
    expect(searchPosts([post('cpp', { title: 'C++ 学习' })], { ...state, q: 'Ｃ＋＋' }).total).toBe(1);
  });

  it('shows a body excerpt where the query matches', () => {
    const item = post('body', { description: '一篇记录', body: `${'前文'.repeat(90)} checkpoint 恢复流程 ${'后文'.repeat(100)}` });
    const excerpt = searchExcerpt(item, 'checkpoint');
    expect(excerpt).toContain('checkpoint');
    expect(excerpt.length).toBeLessThanOrEqual(162);
  });

  it('indexes readable markdown and code without importing MDX components', () => {
    const text = searchableText('import Widget from "./private-name";\n## 标题\n[说明](https://example.com)\n<Widget token="ignore" />\n```js\nconst answer = 42;\n```');
    expect(text).toContain('标题 说明');
    expect(text).toContain('const answer = 42');
    expect(text).not.toMatch(/private-name|token|https:|Widget/);
  });
});

describe('search URLs and pagination', () => {
  it('round-trips shareable filters and the current results page', () => {
    const filters: SearchState = { q: '向量检索 sqlite', tag: 'C++', month: '2026-11', sort: 'oldest', page: 4 };
    expect(stateFromUrl(new URL(searchHref(filters), 'https://yvxi.cyjin.dev'))).toEqual(filters);
  });

  it('uses real static page links when no filters are active', () => {
    expect(searchHref({ ...state, page: 3 })).toBe('/blog/page/3/');
    expect(stateFromUrl(new URL('https://yvxi.cyjin.dev/blog/page/3/'))).toEqual({ ...state, page: 3 });
    expect(searchHref(state)).toBe('/blog/');
  });

  it('normalizes invalid URL values', () => {
    expect(stateFromUrl(new URL('https://yvxi.cyjin.dev/blog/?page=-8&month=2026-13&sort=unknown'))).toEqual(state);
    expect(stateFromUrl(new URL('https://yvxi.cyjin.dev/blog/?page=NaN')).page).toBe(1);
  });

  it('keeps first, last and nearby pages visible without rendering every page', () => {
    expect(pageNumbers(6, 12)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12]);
    expect(pageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageNumbers(12, 12)).toEqual([1, 'gap', 9, 10, 11, 12]);
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(50, 100)).toHaveLength(7);
  });
});
