import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import compress from '@playform/compress';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeImages from './src/lib/rehype-images.mjs';

// The old post-build compressor changed CSS after its URL was hashed. Give all
// corrected CSS (including ?url imports) fresh URLs while keeping other assets.
const cssAssetRevision = {
  name: 'css-asset-revision',
  hooks: {
    'astro:build:setup': ({ vite }) => {
      for (const config of [vite, ...Object.values(vite.environments ?? {})]) {
        const output = config.build?.rolldownOptions?.output;
        for (const options of [output].flat()) {
          const original = options?.assetFileNames;
          if (!original) continue;
          options.assetFileNames = (asset) => {
            const pattern = typeof original === 'function' ? original(asset) : original;
            return asset.names?.some((name) => name.endsWith('.css'))
              ? pattern.replace('[hash]', '[hash].v2')
              : pattern;
          };
        }
      }
    },
  },
};

export default defineConfig({
  site: 'https://yvxi.cyjin.dev',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'never' },
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex, rehypeImages],
    }),
  },
  integrations: [
    mdx(),
    react(),
    sitemap(),
    // Image compression runs all files concurrently and can exhaust build memory.
    // Keep original artwork; image dimensions and lazy loading are handled above.
    // Astro already minifies CSS. The extra csso pass drops media range queries.
    compress({ CSS: false, Image: false }),
    cssAssetRevision,
  ],
});
