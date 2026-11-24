export type PageNumber = number | 'gap';

export function pageNumbers(current: number, total: number): PageNumber[] {
  total = Math.max(1, Math.floor(total) || 1);
  current = Math.min(total, Math.max(1, Math.floor(current) || 1));
  const pages = new Set([1, total]);
  const start = Math.max(2, Math.min(current - 1, total - 3));
  const end = Math.min(total - 1, Math.max(current + 1, 4));
  for (let page = start; page <= end; page++) pages.add(page);
  const result: PageNumber[] = [];
  let previous = 0;
  for (const page of [...pages].sort((a, b) => a - b)) {
    if (previous && page - previous > 1) result.push('gap');
    result.push(page);
    previous = page;
  }
  return result;
}

export function blogPageHref(page: number): string {
  return page > 1 ? `/blog/page/${Math.floor(page)}/` : '/blog/';
}
