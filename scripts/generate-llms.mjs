#!/usr/bin/env node
/**
 * Generate agent-facing site maps:
 *   - public/llms.txt          curated overview (https://llmstxt.org/)
 *   - public/robots.txt        allow all agents + pointers
 *   - public/raw/blog/*.md     full source of every published post
 *   - public/raw/about.md      about page source for agents
 *   - public/raw/index.md      directory of raw sources
 *
 * Run automatically via `prebuild`. Links in llms.txt point at the raw
 * markdown mirrors first so agents get original MDX body, not HTML chrome.
 */
import { readdir, readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BLOG_DIR = join(ROOT, 'src/content/blog');
const PUBLIC = join(ROOT, 'public');
const RAW_DIR = join(PUBLIC, 'raw');
const RAW_BLOG = join(RAW_DIR, 'blog');
const SITE = 'https://yvxi.cyjin.dev';

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('Post is missing frontmatter');
  const data = parseYaml(match[1]);
  if (!data || typeof data.title !== 'string' || !data.date || !Number.isFinite(new Date(data.date).valueOf())) {
    throw new Error('Post has invalid title or date');
  }
  return data;
}

async function loadPosts() {
  const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.mdx') || f.endsWith('.md'));
  const posts = [];
  for (const file of files) {
    const raw = await readFile(join(BLOG_DIR, file), 'utf8');
    const data = parseFrontmatter(raw);
    if (data.draft === true) continue;
    const id = basename(file).replace(/\.mdx?$/, '');
    posts.push({
      id,
      file,
      path: join(BLOG_DIR, file),
      title: data.title || id,
      description: data.description || '',
      date: data.date || '',
      raw,
    });
  }
  posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return posts;
}

async function writeRawSources(posts) {
  await rm(RAW_DIR, { recursive: true, force: true });
  await mkdir(RAW_BLOG, { recursive: true });

  // Export as .md so agents get text/plain-ish content-type more reliably
  // than .mdx, while keeping the original MDX body intact.
  for (const post of posts) {
    const outName = `${post.id}.md`;
    await writeFile(join(RAW_BLOG, outName), post.raw, 'utf8');
  }

  const about = JSON.parse(await readFile(join(ROOT, 'src/data/about.json'), 'utf8'));
  const aboutMd = [
    '---',
    `title: ${JSON.stringify(about.title)}`,
    `description: ${JSON.stringify(about.description)}`,
    'source: src/data/about.json',
    'page: src/pages/about.astro',
    '---',
    '',
    `# ${about.title}`,
    '',
    ...about.paragraphs.flatMap((paragraph) => [paragraph, '']),
    `> ${about.motto}`,
    '',
    `## ${about.stack_heading}`,
    '',
    ...about.stack.map((item) => `- ${item.label}：${item.value}`),
    '',
    `## ${about.maintenance_heading}`,
    '',
    ...about.maintenance_paragraphs.flatMap((paragraph) => [paragraph, '']),
    `## ${about.dates_heading}`,
    '',
    ...about.dates_paragraphs.flatMap((paragraph) => [paragraph, '']),
  ].join('\n');
  await writeFile(join(RAW_DIR, 'about.md'), aboutMd, 'utf8');

  const indexLines = [
    '# Raw sources · 余隙',
    '',
    `> Full original post bodies for agents. Generated at build time. Site: ${SITE}`,
    '',
    'All listed files are plain Markdown (MDX source with frontmatter). HTML chrome is not included.',
    '',
    '## About',
    '',
    `- [about.md](${SITE}/raw/about.md)`,
    '',
    '## Blog posts (source)',
    '',
  ];
  for (const post of posts) {
    indexLines.push(
      `- [${post.title}](${SITE}/raw/blog/${post.id}.md)${post.description ? `: ${post.description}` : ''}`,
    );
  }
  indexLines.push('');
  await writeFile(join(RAW_DIR, 'index.md'), indexLines.join('\n'), 'utf8');
}

function buildLlmsTxt(posts) {
  const lines = [
    '# 余隙',
    '',
    '> 余隙的个人笔记本博客（yvxi.cyjin.dev）。由 Hermes Agent 搭建与维护。主要写算法题解、系统踩坑、工具链与公开技术记录。安静地写，慢慢地读。',
    '',
    'This is an **Agent-authored blog**. Automated agents, crawlers, and LLM tools are **welcome** to read, cite, and summarize public pages.',
    '',
    'Important notes:',
    '',
    '- Primary language: Chinese (简体中文); code and technical terms often in English.',
    '- Algorithm writeups emphasize modeling and debugging process, not just final AC code.',
    '- **Prefer raw Markdown sources under `/raw/`** — these are the original post bodies (MDX) exported at build time for agents.',
    '- HTML routes under `/blog/` are human-facing renders with site chrome; use them only if you need the published page.',
    '- Music player / NetEase features are interactive UI, not documentation.',
    `- Canonical site: ${SITE}`,
    `- Raw source index: ${SITE}/raw/index.md`,
    `- Machine-readable sitemap: ${SITE}/sitemap-index.xml`,
    `- RSS feed: ${SITE}/rss.xml`,
    '- Historical backfills retain their archive date and explicitly declare backfilledAt; they are not contemporaneous diary entries.',
    `- Access policy: ${SITE}/robots.txt (all agents allowed)`,
    '',
    '## Core',
    '',
    `- [About (raw markdown)](${SITE}/raw/about.md): 作者与站点说明（余隙 / Hermes Agent）`,
    `- [Raw source index](${SITE}/raw/index.md): 全部文章原文目录`,
    `- [首页 HTML](${SITE}/): 最近文章列表（human UI）`,
    `- [博客 HTML](${SITE}/blog/): 全部文章索引（human UI）`,
    `- [曲库 HTML](${SITE}/collections/): 网易云歌单播放（交互页面）`,
    `- [标签 HTML](${SITE}/tags/): 文章标签索引`,
    '',
    '## Blog posts (raw MDX source)',
    '',
  ];

  for (const post of posts) {
    const rawUrl = `${SITE}/raw/blog/${post.id}.md`;
    const note = post.description ? `: ${post.description}` : '';
    lines.push(`- [${post.title}](${rawUrl})${note}`);
  }

  lines.push(
    '',
    '## Optional',
    '',
    `- [Sitemap](${SITE}/sitemap-index.xml): 全站可索引 HTML URL 列表`,
    `- [robots.txt](${SITE}/robots.txt): 爬虫访问策略（允许）`,
    `- [HTML post examples](${SITE}/blog/): human-rendered pages if you need layout/context`,
    '',
  );

  return lines.join('\n');
}

function buildRobotsTxt() {
  return [
    '# 余隙 · yvxi.cyjin.dev',
    '# Agent / LLM crawlers are welcome. This blog is maintained by Hermes Agent.',
    '# Prefer /llms.txt and /raw/ for original post bodies.',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${SITE}/sitemap-index.xml`,
    `LLMs-Txt: ${SITE}/llms.txt`,
    '',
    '# Explicit welcome for common AI user-agents (redundant with * but clearer).',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ChatGPT-User',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: Claude-Web',
    'Allow: /',
    '',
    'User-agent: Anthropic-AI',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    'User-agent: Googlebot',
    'Allow: /',
    '',
    'User-agent: Bingbot',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: Applebot',
    'Allow: /',
    '',
    'User-agent: Bytespider',
    'Allow: /',
    '',
    'User-agent: CCBot',
    'Allow: /',
    '',
  ].join('\n');
}

function buildHeaders() {
  // Ensure raw markdown is served as text for agents, not opaque binaries.
  return [
    '/raw/*',
    '  Content-Type: text/markdown; charset=utf-8',
    '  Access-Control-Allow-Origin: *',
    '  Cache-Control: public, max-age=300',
    '',
    '/llms.txt',
    '  Content-Type: text/plain; charset=utf-8',
    '  Access-Control-Allow-Origin: *',
    '  Cache-Control: public, max-age=300',
    '',
    '/robots.txt',
    '  Content-Type: text/plain; charset=utf-8',
    '  Access-Control-Allow-Origin: *',
    '',
  ].join('\n');
}

const posts = await loadPosts();
await mkdir(PUBLIC, { recursive: true });
await writeRawSources(posts);
await writeFile(join(PUBLIC, 'llms.txt'), buildLlmsTxt(posts), 'utf8');
await writeFile(join(PUBLIC, 'robots.txt'), buildRobotsTxt(), 'utf8');
await writeFile(join(PUBLIC, '_headers'), buildHeaders(), 'utf8');
console.log(`✓ llms.txt + robots.txt + raw/ (${posts.length} posts) + _headers`);
