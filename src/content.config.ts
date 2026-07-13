import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';

export const collections = {
  blog: defineCollection({
    loader: glob({ base: './src/content/blog', pattern: '*.mdx' }),
    schema: z.object({
      title: z.string(),
      description: z.string().optional(),
      date: z.date(),
      tags: z.array(z.string()).optional(),
      draft: z.boolean().optional(),
    }),
  }),
};
