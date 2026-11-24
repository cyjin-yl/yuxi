import { createHash } from 'node:crypto';
import { getPublishedPosts } from './posts';
import { searchableText, type SearchPost } from './blog-search';

async function buildIndex() {
  const entries = await getPublishedPosts();
  const posts: SearchPost[] = entries.map((post) => ({
    id: post.id,
    title: post.data.title,
    description: post.data.description ?? '',
    tags: post.data.tags ?? [],
    date: post.data.date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
    backfilled: Boolean(post.data.backfilledAt),
    body: searchableText(post.body ?? ''),
  }));
  const json = JSON.stringify({ version: 1, posts });
  return { posts, json, hash: createHash('sha256').update(json).digest('hex').slice(0, 16) };
}

let index: ReturnType<typeof buildIndex> | undefined;
export function getBlogSearchIndex() {
  return import.meta.env.DEV ? buildIndex() : (index ??= buildIndex());
}
