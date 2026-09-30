import type { InfotelefonAnliegen, MedienkontaktArt } from '../api/types';

/**
 * Wortlaute der S5-Enums (LFH-554). Exhaustive `Record`s: eine neue Backend-Variante bricht den
 * Typcheck statt still ohne Wort zu erscheinen. Farben stehen NICHT hier, sondern im Vertrag
 * `theme/statusFarben.ts`.
 */
export const MEDIENKONTAKT_ART_LABEL: Record<MedienkontaktArt, string> = {
  anfrage: 'Anfrage',
  abstimmung: 'Abstimmung',
  termin: 'Termin',
};

/** Reihenfolge und Wortlaut der Anliegen am Informationstelefon. */
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
export const ART_REIHENFOLGE = Object.keys(MEDIENKONTAKT_ART_LABEL) as MedienkontaktArt[];
