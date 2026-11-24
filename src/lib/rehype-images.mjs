import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/** Reserve public image dimensions at build time and defer offscreen decoding. */
export default function rehypeImages() {
  const cache = new Map();
  const root = resolve('public');
  async function dimensions(src) {
    if (typeof src !== 'string' || !src.startsWith('/') || src.startsWith('//')) return null;
    const path = resolve(root, src.slice(1).split(/[?#]/)[0]);
    if (!path.startsWith(root + sep)) return null;
    if (!cache.has(path)) cache.set(path, (async () => {
      try {
        const bytes = await readFile(path);
        if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
          return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
        }
        if (path.endsWith('.svg')) {
          const svg = bytes.toString('utf8');
          const viewBox = svg.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
          if (viewBox) return [Number(viewBox[1]), Number(viewBox[2])];
        }
      } catch { /* An author-supplied remote/missing image retains its fallback. */ }
      return null;
    })());
    return cache.get(path);
  }
  return async (tree) => {
    const jobs = [];
    function visit(node) {
      if (node.type === 'element' && node.tagName === 'img') {
        jobs.push((async () => {
          const props = node.properties ??= {};
          props.loading ??= 'lazy';
          props.decoding ??= 'async';
          const size = await dimensions(props.src);
          if (size) { props.width ??= size[0]; props.height ??= size[1]; }
        })());
      } else if (node.name === 'img' && Array.isArray(node.attributes)) {
        jobs.push((async () => {
          const props = Object.fromEntries(node.attributes.filter((a) => a.type === 'mdxJsxAttribute').map((a) => [a.name, a.value]));
          const values = { loading: 'lazy', decoding: 'async' };
          const size = await dimensions(props.src);
          if (size) { values.width = String(size[0]); values.height = String(size[1]); }
          for (const [name, value] of Object.entries(values)) if (!(name in props)) node.attributes.push({ type: 'mdxJsxAttribute', name, value });
        })());
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
    await Promise.all(jobs);
  };
}
