export interface SearchPost {
  id: string;
  title: string;
  description: string;
  tags: string[];
  date: string;
  backfilled: boolean;
  body: string;
}

export interface SearchState {
  q: string;
  tag: string;
  month: string;
  sort: 'relevance' | 'newest' | 'oldest';
  page: number;
}

export const SEARCH_PAGE_SIZE = 12;
export const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN');

export function searchTerms(query: string): string[] {
  return [...new Set(normalized(query).replace(/[，,。！？!?、；;:：“”‘’"'()[\]{}<>]/g, ' ').split(/\s+/u).filter(Boolean))].slice(0, 12);
}

export function stateFromUrl(url: URL): SearchState {
  const p = url.searchParams;
  const pathPage = url.pathname.match(/^\/blog\/page\/(\d+)\/?$/)?.[1];
  const page = Number(p.get('page') ?? pathPage ?? 1);
  const sort = p.get('sort');
  const month = p.get('month') ?? '';
  return {
    q: (p.get('q') ?? '').trim().slice(0, 200),
    tag: (p.get('tag') ?? '').slice(0, 100),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : '',
    sort: sort === 'newest' || sort === 'oldest' ? sort : 'relevance',
    page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1,
  };
}

export function searchHref(state: SearchState): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.tag) params.set('tag', state.tag);
  if (state.month) params.set('month', state.month);
  if (state.sort !== 'relevance') params.set('sort', state.sort);
  if (!params.size) return state.page > 1 ? `/blog/page/${state.page}/` : '/blog/';
  if (state.page > 1) params.set('page', String(state.page));
  return `/blog/?${params}`;
}

export function searchPosts(posts: SearchPost[], state: SearchState) {
  const terms = searchTerms(state.q);
  const phrase = normalized(state.q);
  const matches = posts.flatMap((post) => {
    if (state.tag && !post.tags.includes(state.tag)) return [];
    if (state.month && !post.date.startsWith(state.month)) return [];
    const title = normalized(post.title);
    const description = normalized(post.description);
    const tags = post.tags.map(normalized);
    const body = normalized(post.body);
    let score = 0;
    for (const term of terms) {
      const points = (title.includes(term) ? 12 : 0)
        + (description.includes(term) ? 6 : 0)
        + (tags.some((tag) => tag === term) ? 10 : tags.some((tag) => tag.includes(term)) ? 5 : 0)
        + (body.includes(term) ? 1 : 0);
      if (!points) return [];
      score += points;
    }
    if (phrase && title.includes(phrase)) score += 4;
    return [{ post, score }];
  });
  matches.sort((a, b) => {
    if (state.sort === 'relevance' && terms.length && a.score !== b.score) return b.score - a.score;
    const date = b.post.date.localeCompare(a.post.date);
    return (state.sort === 'oldest' ? -date : date) || a.post.id.localeCompare(b.post.id);
  });
  const totalPages = Math.max(1, Math.ceil(matches.length / SEARCH_PAGE_SIZE));
  const page = Math.min(state.page, totalPages);
  return { posts: matches.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE).map((item) => item.post), total: matches.length, totalPages, page };
}

export function searchExcerpt(post: SearchPost, query: string): string {
  const terms = searchTerms(query);
  if (!terms.length || terms.some((term) => normalized(post.description).includes(term))) return post.description || post.body.slice(0, 160);
  const body = normalized(post.body);
  const positions = terms.map((term) => body.indexOf(term)).filter((at) => at >= 0);
  if (!positions.length) return post.description || post.body.slice(0, 160);
  const start = Math.max(0, Math.min(...positions) - 45);
  const excerpt = post.body.slice(start, start + 160);
  return `${start ? '…' : ''}${excerpt}${start + excerpt.length < post.body.length ? '…' : ''}`;
}

/** Plain text for matching and snippets; never inserted as HTML. */
export function searchableText(body: string): string {
  return body
    .replace(/^\s*(?:import|export)\s+[^\n]+(?:\n|$)/gm, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/[#*_`~|]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
