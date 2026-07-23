import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import compress from '@playform/compress';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  site: 'https://yvxi.pages.dev',
  integrations: [
    mdx({
      extendsExisting: true,
      remarkPlugins: [
        [
          remarkMath,
          {
            // Use LaTeX delimiters to avoid Oxc JSX parsing conflict
            inline: [{ left: '\\(', right: '\\)' }],
            display: [{ left: '\\[', right: '\\]', display: true }],
          },
        ],
      ],
      rehypePlugins: [rehypeKatex],
    }),
    react(),
    sitemap(),
    compress(),
  ],
});
