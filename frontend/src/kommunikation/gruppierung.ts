/** Fälligkeits-Gruppierung der Kommunikations-Module: Überfällig → Heute → Später → Ohne Frist. */
import dayjs, { type Dayjs } from 'dayjs';
import { alsZeitpunkt, heuteInZone, tagInZone } from '../anzeige/zeitEingabe';

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
 * `frist` ist ein UTC-Wirestring; verglichen wird der Kalendertag in der Anzeigezone `zone`
 * (`null` = Browserzone), nicht der des Geräts (LFH-692, Spec `zeiteingabe`).
 */
export function faelligGruppe(
  frist?: string | null,
  ueberfaellig?: boolean,
  zone: string | null = null,
  jetzt: Dayjs = dayjs(),
): FaelligGruppe {
  if (ueberfaellig) return 'ueberfaellig';
  const zeitpunkt = alsZeitpunkt(frist);
  if (!zeitpunkt) return 'ohne_frist';
  // `YYYY-MM-DD` vergleicht als String chronologisch.
  const tag = tagInZone(zeitpunkt, zone);
  const heute = heuteInZone(zone, jetzt);
  if (tag === heute) return 'heute';
  return tag < heute ? 'ueberfaellig' : 'spaeter';
}
