/**
 * Zwei Quellen außerhalb der Website, hier nur gelesen, nie kopiert:
 *
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

/**
 * Architekturdokumentation (LLH-1435): die arc42-Kapitel `docs/architektur/NN-*.md` samt Einstieg
 * `README.md` und die Entscheidungen `docs/architektur/entscheidungen/ADR-*.md`. Form und Regeln:
 * `docs/architektur/AGENTS.md`. Die Kennung bleibt der Dateiname (der Glob-Loader würde sie sonst
 * kleinschreiben), damit Adresse und Datei gleich heißen.
 */
const dateiname = ({ entry }: { entry: string }) => entry.replace(/\.md$/, '');

const architektur = defineCollection({
  loader: glob({
    pattern: ['[0-9][0-9]-*.md', 'README.md'],
    base: '../docs/architektur',
    generateId: dateiname,
  }),
});

/** YAML liest `2026-05-23` als Datum; die Seite zeigt es als Text wie in der Datei. */
const datum = z.union([z.string(), z.date()]).transform((d) =>
  typeof d === 'string' ? d : d.toISOString().slice(0, 10),
);

const entscheidungen = defineCollection({
  loader: glob({
    pattern: 'ADR-*.md',
    base: '../docs/architektur/entscheidungen',
    generateId: dateiname,
  }),
  schema: z.object({
    id: z.string(),
    titel: z.string(),
    status: z.enum(['vorgeschlagen', 'akzeptiert', 'ersetzt', 'verworfen']),
    datum,
    gilt_fuer: z.array(z.string()).min(1),
    herleitung: z.array(z.string()).optional(),
    ersetzt: z.string().optional(),
    ersetzt_durch: z.string().optional(),
  }),
});

export const collections = { kapitel, architektur, entscheidungen };
