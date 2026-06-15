/**
 * Fälligkeits-Gruppierung der Kommunikations-Module (LFH-112).
 *
 * Gruppiert offene Einträge nach Frist in Überfällig → Heute → Später → Ohne Frist.
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export type FaelligGruppe = 'ueberfaellig' | 'heute' | 'spaeter' | 'ohne_frist';

export const GRUPPE_LABEL: Record<FaelligGruppe, string> = {
  ueberfaellig: 'Überfällig',
  heute: 'Heute fällig',
  spaeter: 'Später',
  ohne_frist: 'Ohne Frist',
};

/** Sortier-Reihenfolge ueberfaellig < heute < spaeter < ohne_frist. */
export const GRUPPE_ORDNUNG: FaelligGruppe[] = ['ueberfaellig', 'heute', 'spaeter', 'ohne_frist'];

/**
 * Ordnet einen Eintrag einer Fälligkeits-Gruppe zu.
 * `ueberfaellig` (server-/tick-getrieben) hat Vorrang vor der Frist-Auswertung.
 * `frist` ist ein UTC-Wirestring; verglichen wird gegen den lokalen Tag.
 */
export function faelligGruppe(frist?: string | null, ueberfaellig?: boolean): FaelligGruppe {
  if (ueberfaellig) return 'ueberfaellig';
  if (!frist) return 'ohne_frist';
  const lokal = dayjs.utc(frist).local();
  if (lokal.isSame(dayjs(), 'day')) return 'heute';
  return lokal.isBefore(dayjs(), 'day') ? 'ueberfaellig' : 'spaeter';
}
