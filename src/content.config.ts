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
      luogu_url: z.string().optional(),
      luogu_title: z.string().optional(),
      difficulty: z.string().optional(),
      algo_tags: z.array(z.string()).optional(),
      summary: z.string().optional(),
      widget: z.string().optional(),
    }),
  }),
};
