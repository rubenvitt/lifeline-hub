import type { EtbTyp } from '../api/types';

/**
 * ETB-Hilfen ohne Darstellung.
 *
 * `TYP_LABEL`/`TYP_FARBE` sind mit LFH-328/A2 nach `theme/statusFarben.ts` gewandert
 * (`etbTyp`) — Farbe und Text eines Eintragstyps sind Darstellung, und die hat genau
 * eine Quelle. Die Datei bleibt trotz ihres Namens stehen: `ERFASSBARE_TYPEN` ist eine
 * **fachliche** Einschränkung (das Backend lehnt `system`/`berichtigung` in der
 * Schnellerfassung ab, das ist keine Farbfrage), und `istNachgetragen` ist reine
 * Zeitarithmetik. Beide gehören nicht in den Statusfarb-Vertrag. Dass der Dateiname
 * jetzt „Farben" verspricht, die sie nicht mehr trägt, ist ein Befund — eine Umbenennung
 * wäre fünf Importstellen für null fachlichen Gewinn und steht nicht in A2.
 */

/** Vom Client manuell erfassbare Typen (Backend lehnt 'system' und Reihenfolge ab). */
export const ERFASSBARE_TYPEN: EtbTyp[] = ['meldung', 'anordnung', 'lage', 'entscheidung'];

/** UTC-SQLite-String 'YYYY-MM-DD HH:MM:SS' → Millisekunden seit Epoch. */
function alsMillis(zeit: string): number {
  return Date.parse(zeit.replace(' ', 'T') + 'Z');
}

/** Schwelle, ab der ereigniszeit als „nachgetragen/gepuffert" gilt. */
export const NACHTRAG_SCHWELLE_MS = 60_000;

/** Ob ereigniszeit spürbar (>= 60 s) vom Server-Empfang abweicht. Schwelle, damit
 *  normale Live-Latenz nicht jeden Eintrag mit ⧖ markiert (Spec §11). */
export function istNachgetragen(ereigniszeit: string, receivedAt: string): boolean {
  const diff = Math.abs(alsMillis(receivedAt) - alsMillis(ereigniszeit));
  return Number.isFinite(diff) && diff >= NACHTRAG_SCHWELLE_MS;
}
