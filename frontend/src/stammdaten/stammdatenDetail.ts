import { adminSektionPfad } from '../admin/adminNav';

/**
 * Detail-Adressen der Stammdaten-Verwaltung (LFH-346 · A7).
 *
 * Sie hängen an `adminSektionPfad` und **nicht** an `routing/deeplinks.ts`: dort liegen die
 * Einsatz-Pfade (`/einsaetze/:id/…`), hier die Verwaltung (`/admin/…`). Zwei Quellen für
 * dieselbe Adressfamilie wären genau die Lage, gegen die LFH-25 gebaut wurde — das
 * Ticket-AK, das `deeplinks.ts` nennt, ist falsch adressiert.
 *
 * `parseRouteId` wird dagegen aus `routing/deeplinks.ts` **importiert** und hier nicht
 * nachgebaut: die Regel „positive Ganzzahl, sonst Redirect" ist eine, nicht zwei, und ihre
 * Randfälle (`'0'`, `'abc'`, `''`, Dezimalzahlen) sind dort bereits gepinnt.
 */

/** `/admin/stammdaten/fahrzeuge/<id>`. */
export function fahrzeugDetailPfad(id: number): string {
  return `${fahrzeugListePfad()}/${id}`;
}

/** `/admin/stammdaten/personal/<id>`. */
export function personalDetailPfad(id: number): string {
  return `${personalListePfad()}/${id}`;
}

/** Rückweg der Fahrzeug-Detailseite — zugleich das Ziel einer ungültigen Route-ID. */
export function fahrzeugListePfad(): string {
  return adminSektionPfad('stammdaten', 'fahrzeuge');
}

/** Rückweg der Personal-Detailseite. */
export function personalListePfad(): string {
  return adminSektionPfad('stammdaten', 'personal');
}
