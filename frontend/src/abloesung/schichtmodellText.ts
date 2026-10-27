import type { AnzeigeKonventionen } from '../anzeige/format';
import type { EinsatzSchichtmodell } from '../api/types';
import { formatDauer, formatUhrzeiten } from './dauer';

/**
 * Die Regel eines Schichtmodells als Text (LLH-1122), für Stammdaten, Einsatz-Einstellungen,
 * die Ablösungsseite und Platzhalter. Dauern über `formatDauer`, Wechselzeiten in der
 * Zeitdarstellung (`formatUhrzeiten`, LLH-1437).
 * Gegenstück zu `Regel::text` im Server (`src/schichtmodell/mod.rs`), dort für das ETB.
 */

/** Was die Regel trägt — ein Modell der Organisation und die Kopie am Einsatz gleich. */
export type RegelFelder = Pick<
  EinsatzSchichtmodell,
  'typ' | 'rhythmus_minuten' | 'wechselzeiten' | 'mindestdauer_minuten'
>;

/** „Rhythmus 12 h“ · „Wechsel 0600/1800 · Mindestdauer 4 h“ · „Wechsel 0600/1800“. */
export function formatRegel(m: RegelFelder, konv: AnzeigeKonventionen): string {
  if (m.typ === 'rhythmus') return `Rhythmus ${formatDauer(m.rhythmus_minuten ?? 0)}`;
  const wechsel = `Wechsel ${formatUhrzeiten(m.wechselzeiten ?? [], konv)}`;
  return m.mindestdauer_minuten
    ? `${wechsel} · Mindestdauer ${formatDauer(m.mindestdauer_minuten)}`
    : wechsel;
}

/** Kurzform für Platzhalter eines Rhythmusfeldes: „12 h“ · „Wechsel 0600/1800“. */
export function formatRegelKurz(m: RegelFelder, konv: AnzeigeKonventionen): string {
  return m.typ === 'rhythmus'
    ? formatDauer(m.rhythmus_minuten ?? 0)
    : `Wechsel ${formatUhrzeiten(m.wechselzeiten ?? [], konv)}`;
}
