import { getBlogSearchIndex } from '../../lib/blog-search-index';

export const prerender = true;
export async function GET() {
  const index = await getBlogSearchIndex();
  return new Response(index.json, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
