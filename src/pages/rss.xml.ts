import type { APIRoute } from 'astro';
import { getPublishedPosts } from '../lib/posts';

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]!));

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL('https://yvxi.cyjin.dev');
  const posts = await getPublishedPosts();
  const published = (post: typeof posts[number]) => post.data.backfilledAt ?? post.data.date;
  const sorted = [...posts].sort((a, b) => published(b).valueOf() - published(a).valueOf() || b.data.date.valueOf() - a.data.date.valueOf());
  const items = sorted.map((post) => {
    const url = new URL(`/blog/${post.id}/`, base).href;
    const archive = post.data.date.toISOString().slice(0, 10);
    const note = post.data.backfilledAt ? `历史补写，归档日期 ${archive}。` : '';
    return `<item><title>${escapeXml(post.data.title)}</title><link>${escapeXml(url)}</link><guid isPermaLink="true">${escapeXml(url)}</guid><pubDate>${published(post).toUTCString()}</pubDate><description>${escapeXml(note + (post.data.description ?? ''))}</description>${(post.data.tags ?? []).map((tag) => `<category>${escapeXml(tag)}</category>`).join('')}</item>`;
  });
  const lastBuildDate = sorted[0] ? `<lastBuildDate>${published(sorted[0]).toUTCString()}</lastBuildDate>` : '';
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>余隙</title><link>${base.href}</link><description>余隙的笔记本。安静地写，慢慢地读。</description><language>zh-cn</language><atom:link href="${new URL('/rss.xml', base).href}" rel="self" type="application/rss+xml"/>${lastBuildDate}${items.join('')}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
