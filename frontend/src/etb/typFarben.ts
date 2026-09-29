import type { EtbTyp } from '../api/types';

/**
 * ETB-Hilfen ohne Darstellung.
 *
 * Farbe und Text eines Eintragstyps stehen in `theme/statusFarben.ts` (`etbTyp`). Hier bleiben
 * `ERFASSBARE_TYPEN`, eine **fachliche** Einschränkung (das Backend lehnt `system`/
 * `berichtigung` in der Schnellerfassung ab), und `istNachgetragen` als reine Zeitarithmetik.
 * Der Dateiname ist historisch; eine Umbenennung brächte keinen fachlichen Gewinn.
 */

/** Vom Client manuell erfassbare Typen. */
export const ERFASSBARE_TYPEN: EtbTyp[] = ['meldung', 'anordnung', 'lage', 'entscheidung'];

/** UTC-SQLite-String 'YYYY-MM-DD HH:MM:SS' → Millisekunden seit Epoch. */
function alsMillis(zeit: string): number {
  return Date.parse(zeit.replace(' ', 'T') + 'Z');
}

/** Schwelle, ab der ereigniszeit als „nachgetragen/gepuffert" gilt. */
const NACHTRAG_SCHWELLE_MS = 60_000;

/** Ob ereigniszeit spürbar (>= 60 s) vom Server-Empfang abweicht. Schwelle, damit
 *  normale Live-Latenz nicht jeden Eintrag mit ⧖ markiert (Spec §11). */
export function istNachgetragen(ereigniszeit: string, receivedAt: string): boolean {
  const diff = Math.abs(alsMillis(receivedAt) - alsMillis(ereigniszeit));
  return Number.isFinite(diff) && diff >= NACHTRAG_SCHWELLE_MS;
}
