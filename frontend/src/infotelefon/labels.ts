import type { InfotelefonAnliegen } from '../api/types';

/**
 * Reihenfolge und Wortlaut der Anliegen am Informationstelefon (LFH-554). Exhaustiver `Record`:
 * eine neue Backend-Variante bricht den Typcheck statt still ohne Wort zu erscheinen. Das Anliegen
 * `presse` („Presseanfrage“) bleibt ein Anliegen eines Bürgers, auch ohne Presse-Modul (i6k6mzed,
 * design.md D3). Farben stehen NICHT hier, sondern im Vertrag `theme/statusFarben.ts`.
 */
export const ANLIEGEN_LABEL: Record<InfotelefonAnliegen, string> = {
  vermisstensuche: 'Vermisstensuche',
  auskunft_lage: 'Auskunft zur Lage',
  hinweis: 'Hinweis zur Lage',
  hilfeangebot: 'Hilfeangebot',
  beschwerde: 'Beschwerde',
  presse: 'Presseanfrage',
  sonstiges: 'Sonstiges',
};

export const ANLIEGEN_REIHENFOLGE = Object.keys(ANLIEGEN_LABEL) as InfotelefonAnliegen[];
