import type { EinsatzRolle } from '../api/types';

/**
 * Beschriftungen der Einsatzrollen (LFH-946), geteilt von der Einsatzkachel und der
 * Mitgliederverwaltung. Wie bei `EINSATZART_LABELS`: der `Record` über `EinsatzRolle` bricht den
 * Build, sobald der Typ-Codegen eine Rolle ergänzt, statt still den Rohwert zu zeigen.
 */
export const EINSATZ_ROLLE_LABELS: Record<EinsatzRolle, string> = {
  einsatzleitung: 'Einsatzleitung',
  fuehrungspersonal: 'Führungspersonal',
  mitarbeit: 'Mitarbeit',
  beobachter: 'Beobachter',
};

/**
 * Zweite Zeile einer Rolle in der Rollenwahl (LLH-1817): nur die Mitarbeit braucht sie, denn ihr
 * Name sagt nicht, dass sie erfasst und sonst nichts ändert.
 */
export const EINSATZ_ROLLE_BESCHREIBUNG: Partial<Record<EinsatzRolle, string>> = {
  mitarbeit: 'Erfasst Meldungen, Chat und ETB-Einträge, ändert sonst nichts.',
};

/** Die Rollen als `Select`-Optionen, in der Reihenfolge des `Record`. */
export const EINSATZ_ROLLE_OPTIONEN = (Object.keys(EINSATZ_ROLLE_LABELS) as EinsatzRolle[]).map(
  (k) => ({ value: k, label: EINSATZ_ROLLE_LABELS[k] }),
);
