import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Erinnerung } from '../api/types';

dayjs.extend(utc);

/** Wort und Ton einer fälligen Erinnerung — die „Nächsten Marken“ lesen sie, wenn ihre Zeit
 *  verstrichen ist ({@link erinnerungZustand}). */
export const ERINNERUNG_FAELLIG = { wort: 'fällig', ton: 'achtung' } as const;

/**
 * Zustand einer offenen Erinnerung im Überblick (LLH-1749, Spec `ueberblick-offene-vorgaenge`):
 * EINE Stelle für Wort und Ton, die der Abschnitt „Erinnerungen“ der Offenen Vorgänge und die
 * „Nächsten Marken“ gemeinsam lesen — vorher hieß dieselbe Erinnerung dort „fällig“ (gelb) und
 * hier „überfällig“ (rot). Eine Erinnerung ist ein Wecker, keine Frist mit Soll: sie wird „fällig“
 * in der Achtungsrolle, nie „überfällig“ in Alarm.
 *
 * Fällig heißt `ist_faellig` vom Server ODER `faellig_at <= jetzt`: so schlägt sie mit der
 * Seitenuhr um, gleichzeitig mit der Marke, ohne neuen Abruf. `jetzt` in Millisekunden (UTC).
 */
export function erinnerungZustand(
  e: Pick<Erinnerung, 'ist_faellig' | 'faellig_at'>,
  jetzt: number,
): { wort: 'fällig' | 'bald'; ton: 'achtung' | null } {
  const faellig = dayjs.utc(e.faellig_at);
  const erreicht = e.ist_faellig || (faellig.isValid() && faellig.valueOf() <= jetzt);
  return erreicht ? { ...ERINNERUNG_FAELLIG } : { wort: 'bald', ton: null };
}
