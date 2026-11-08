import type { MedienkontaktArt } from '../api/types';

/**
 * Wortlaute der S5-Enums (LFH-554). Exhaustive `Record`s: eine neue Backend-Variante bricht den
 * Typcheck statt still ohne Wort zu erscheinen. Farben stehen NICHT hier, sondern im Vertrag
 * `theme/statusFarben.ts`. Die Anliegen des Informationstelefons stehen in `infotelefon/labels.ts`.
 */
export const MEDIENKONTAKT_ART_LABEL: Record<MedienkontaktArt, string> = {
  anfrage: 'Anfrage',
  abstimmung: 'Abstimmung',
  termin: 'Termin',
};

export const ART_REIHENFOLGE = Object.keys(MEDIENKONTAKT_ART_LABEL) as MedienkontaktArt[];
