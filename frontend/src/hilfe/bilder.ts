/**
 * Bilder der Anwenderdokumentation (LFH-1128, `docs/anwender/AGENTS.md`, „Bilder“).
 *
 * Die Bildschirmfotos liegen unter `docs/anwender/bilder/<kapitel>/<name>.png` und entstehen per
 * Skript (`pnpm doku:bilder`). Ein Kapitel verweist relativ darauf
 * (`![Alt](../bilder/<kapitel>/<name>.png)`), damit GitHub und die Website dieselbe Datei zeigen.
 * Die App bindet die Dateien beim Bauen als Adressen ein (`?url`): im Chunk der Hilfe steht nur
 * die Adresse, das Bild lädt erst beim Ansehen. Nicht im Precache des Service Workers, sondern im
 * Laufzeit-Cache (`vite.config.ts`, `DOKU_BILDER_CACHE`): rund hundert Bilder lüde sonst jeder
 * Client bei jedem Update.
 */

const PRAEFIX = /^.*\/docs\/anwender\/bilder\//;

/** Ordnet die Glob-Schlüssel (`…/docs/anwender/bilder/<kapitel>/<name>.png`) ihrer Adresse zu. */
export function bilderTabelle(glob: Record<string, string>): Map<string, string> {
  return new Map(
    Object.entries(glob).map(([pfad, adresse]) => [pfad.replace(PRAEFIX, ''), adresse]),
  );
}

const GLOB = import.meta.glob<string>('../../../docs/anwender/bilder/**/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** Alle Bilder der Anwenderdokumentation: `<kapitel>/<name>.png` → gebaute Adresse. */
export const BILDER: ReadonlyMap<string, string> = bilderTabelle(GLOB);

/**
 * Gebaute Adresse zu einem Verweis aus einem Kapitel (`../bilder/<kapitel>/<name>.png`);
 * `undefined` für alles andere. Der Wächter (`anwenderdoku.guard.test.ts`) lässt keine andere
 * Form zu.
 */
export function bildAdresse(
  src: string | undefined,
  tabelle: ReadonlyMap<string, string> = BILDER,
): string | undefined {
  const m = /^\.\.\/bilder\/(.+)$/.exec(src ?? '');
  return m ? tabelle.get(m[1]) : undefined;
}
