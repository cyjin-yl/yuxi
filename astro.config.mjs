import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import compress from '@playform/compress';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeImages from './src/lib/rehype-images.mjs';

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
    compress(),
  ],
});
