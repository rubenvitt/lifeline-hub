import type { EtbTyp } from '../api/types';

export const TYP_LABEL: Record<EtbTyp, string> = {
  meldung: 'Meldung',
  anordnung: 'Anordnung',
  lage: 'Lage',
  entscheidung: 'Entscheidung',
  system: 'System',
  berichtigung: 'Berichtigung',
};

export const TYP_FARBE: Record<EtbTyp, string> = {
  meldung: 'blue',
  anordnung: 'orange',
  lage: 'cyan',
  entscheidung: 'purple',
  system: 'default',
  berichtigung: 'red',
};

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
