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
let published = 0, drafts = 0, backfills = 0;
for (const file of files) {
  const source = await readFile(join('src/content/blog', file), 'utf8');
  const data = parse(source.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]);
  const slug = file.replace(/\.mdx?$/, '');
  const route = `/blog/${slug}/`;
  const rawPath = join(dist, 'raw/blog', `${slug}.md`);
  if (data.draft) {
    drafts++;
    await assert.rejects(access(join(dist, route, 'index.html')), `Draft page leaked: ${slug}`);
    await assert.rejects(access(rawPath), `Draft raw source leaked: ${slug}`);
    assert(!sitemap.includes(route) && !rss.includes(route) && !index.includes(`/raw/blog/${slug}.md`), `Draft index leaked: ${slug}`);
    continue;
  }
  published++;
  const html = await readFile(join(dist, route, 'index.html'), 'utf8');
  assert(html.includes(`https://yvxi.cyjin.dev${route}`), `Canonical mismatch: ${slug}`);
  assert.equal(await readFile(rawPath, 'utf8'), source, `Stale raw source: ${slug}`);
  assert(index.includes(`/raw/blog/${slug}.md`) && llms.includes(`/raw/blog/${slug}.md`) && rss.includes(route) && sitemap.includes(route), `Missing index route: ${slug}`);
  if (data.backfilledAt) { backfills++; assert(html.includes('历史补写') && html.includes('并非当日即时日记'), `Backfill label missing: ${slug}`); }
}
assert.equal((rss.match(/<item>/g) ?? []).length, published, 'RSS count mismatch');
assert.equal((index.match(/\/raw\/blog\//g) ?? []).length, published, 'Raw index count mismatch');
for (const text of [index, llms, rss, sitemap, await readFile(join(dist, 'robots.txt'), 'utf8')]) assert(!text.includes('https://yvxi.pages.dev'), 'Old canonical domain in generated index');
const home = await readFile(join(dist, 'index.html'), 'utf8');
assert(!home.includes('client="load"'), 'Homepage eagerly hydrates an island');
assert(!home.includes('cdn.jsdelivr.net'), 'Homepage depends on third-party executable CDN');
assert(!home.includes('component-url='), 'Homepage eagerly loads a framework component');
console.log(JSON.stringify({ published, draftsExcluded: drafts, backfillsLabeled: backfills, rawSourcesExact: true, indexesConsistent: true, homeEagerIslands: 0 }, null, 2));
