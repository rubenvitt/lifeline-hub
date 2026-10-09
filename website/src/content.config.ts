/**
 * Anwenderdokumentation (LFH-1096): die Kapitel liegen außerhalb der Website unter
 * `docs/anwender/kapitel/` und sind dieselben Dateien, die die App unter „Hilfe“ zeigt. Hier nur
 * gelesen, nie kopiert. Form der Kapitel: `docs/anwender/AGENTS.md`.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { GRUPPEN } from './daten/gruppen';

const gruppe = z.enum(GRUPPEN.map((g) => g.key) as [string, ...string[]]);

const kapitel = defineCollection({
  loader: glob({ pattern: '*.md', base: '../docs/anwender/kapitel' }),
  schema: z.object({
    titel: z.string(),
    gruppen: z.array(gruppe).min(1),
    reihenfolge: z.number().int(),
    quellen: z.array(z.string()).min(1),
  }),
});

export const collections = { kapitel };
