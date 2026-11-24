import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

const dist = process.argv[2] ?? 'dist';
const files = (await readdir('src/content/blog')).filter((name) => /\.mdx?$/.test(name));
const index = await readFile(join(dist, 'raw/index.md'), 'utf8');
const llms = await readFile(join(dist, 'llms.txt'), 'utf8');
const rss = await readFile(join(dist, 'rss.xml'), 'utf8');
const sitemap = await readFile(join(dist, 'sitemap-0.xml'), 'utf8');
const search = JSON.parse(await readFile(join(dist, 'blog/search-index.json'), 'utf8'));
assert.equal(search.version, 1, 'Search index version mismatch');
const searchIds = new Set(search.posts.map((post) => post.id));
let published = 0, drafts = 0, backfills = 0;
for (const file of files) {
  const source = await readFile(join('src/content/blog', file), 'utf8');
  const data = parse(source.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]);
  const slug = file.replace(/\.mdx?$/, '');
  const route = `/blog/${slug}/`;
  const rawPath = join(dist, 'raw/blog', `${slug}.md`);
  if (data.draft) {
    drafts++;
    assert(!searchIds.has(slug), `Draft search source leaked: ${slug}`);
    await assert.rejects(access(join(dist, route, 'index.html')), `Draft page leaked: ${slug}`);
    await assert.rejects(access(rawPath), `Draft raw source leaked: ${slug}`);
    assert(!sitemap.includes(route) && !rss.includes(route) && !index.includes(`/raw/blog/${slug}.md`), `Draft index leaked: ${slug}`);
    continue;
  }
  published++;
  assert(searchIds.has(slug), `Missing search entry: ${slug}`);
  const searchEntry = search.posts.find((post) => post.id === slug);
  assert.equal(searchEntry.title, data.title, `Stale search title: ${slug}`);
  assert.equal(searchEntry.description, data.description ?? '', `Stale search summary: ${slug}`);
  const html = await readFile(join(dist, route, 'index.html'), 'utf8');
  assert(html.includes(`https://yvxi.cyjin.dev${route}`), `Canonical mismatch: ${slug}`);
  assert.equal(await readFile(rawPath, 'utf8'), source, `Stale raw source: ${slug}`);
  assert(index.includes(`/raw/blog/${slug}.md`) && llms.includes(`/raw/blog/${slug}.md`) && rss.includes(route) && sitemap.includes(route), `Missing index route: ${slug}`);
  if (data.backfilledAt) {
    backfills++;
    const when = new Date(data.backfilledAt);
    const day = when.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' });
    assert(html.includes('post-backfill-note') && html.includes('整理于') && html.includes(when.toISOString()) && html.includes(day), `Arrangement date missing: ${slug}`);
  }
}
assert.equal(search.posts.length, published, 'Search entry count mismatch');
assert.equal(searchIds.size, published, 'Duplicate search entries');
assert.equal((rss.match(/<item>/g) ?? []).length, published, 'RSS count mismatch');
assert.equal((index.match(/\/raw\/blog\//g) ?? []).length, published, 'Raw index count mismatch');
for (const text of [index, llms, rss, sitemap, await readFile(join(dist, 'robots.txt'), 'utf8')]) assert(!text.includes('https://yvxi.pages.dev'), 'Old canonical domain in generated index');
const home = await readFile(join(dist, 'index.html'), 'utf8');
assert(!home.includes('client="load"'), 'Homepage eagerly hydrates an island');
assert(!home.includes('cdn.jsdelivr.net'), 'Homepage depends on third-party executable CDN');
assert(!home.includes('component-url='), 'Homepage eagerly loads a framework component');

// Inspect the CSS actually linked by the built page. A later compressor once
// removed every width query while leaving the source styles and build green.
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`))?.slice(1).find((value) => value !== undefined);
const stylePaths = (home.match(/<link\b[^>]*>/g) ?? [])
  .filter((tag) => attribute(tag, 'rel') === 'stylesheet')
  .map((tag) => attribute(tag, 'href'));
assert(stylePaths.length && stylePaths.every((path) => path?.startsWith('/_astro/')), 'Homepage styles must use local built assets');
const css = (await Promise.all(stylePaths.map((path) => readFile(join(dist, path), 'utf8')))).join('\n');
const media = [];
for (const match of css.matchAll(/@media\s*([^{}]+)\{/g)) {
  const start = match.index + match[0].length;
  let end = start, depth = 1, quote = '';
  for (; end < css.length && depth; end++) {
    const char = css[end];
    if (quote) {
      if (char === '\\') end++;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '/' && css[end + 1] === '*') {
      const close = css.indexOf('*/', end + 2);
      assert(close >= 0, 'Unterminated CSS comment');
      end = close + 1;
    } else if (char === '{') depth++;
    else if (char === '}') depth--;
  }
  assert.equal(depth, 0, 'Unterminated built CSS media query');
  media.push({ query: match[1].replace(/\s+/g, ''), body: css.slice(start, end - 1) });
}
function widthRule(bound, pixels, selector, declarations) {
  const queries = bound === 'min'
    ? [`(min-width:${pixels}px)`, `(width>=${pixels}px)`, `(${pixels}px<=width)`]
    : [`(max-width:${pixels}px)`, `(width<=${pixels}px)`, `(${pixels}px>=width)`];
  const bodies = media.filter(({ query }) => queries.includes(query)).map(({ body }) => body).join('\n');
  const rule = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  const matches = [...bodies.matchAll(rule)].map((match) => match[1].replace(/\s+/g, ''));
  for (const declaration of declarations) assert(matches.some((body) => body.split(';').includes(declaration)), `Missing built responsive style: ${bound} ${pixels}px ${selector} ${declaration}`);
}
widthRule('min', 900, '.home-wide .post-list', ['grid-template-columns:repeat(2,minmax(0,1fr))']);
widthRule('min', 1440, '.home-wide .post-list', ['grid-template-columns:repeat(3,minmax(0,1fr))']);
widthRule('min', 1100, '.post-wrapper.has-toc', ['display:grid']);
widthRule('max', 600, '.pagination-pages', ['flex-basis:100%']);
console.log(JSON.stringify({ published, draftsExcluded: drafts, backfillsLabeled: backfills, rawSourcesExact: true, indexesConsistent: true, searchIndexEntries: searchIds.size, homeEagerIslands: 0, responsiveStylesPreserved: true }, null, 2));
