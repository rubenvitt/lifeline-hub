import type { EinsatzFahrzeug } from '../../api/types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { vorText } from '../../anzeige/dauer';

dayjs.extend(utc);

/**
 * Ab wann eine GPS-Position „veraltet“ heißt (LLH-2091): strikt darüber, genau auf der Schwelle
 * noch nicht — wie die Fachebenen (`fachebeneAlter`). Eine Marke in Worten am Marker, kein
 * eigener Status.
 */
export const ORTUNG_VERALTET_NACH_MIN = 10;

export interface OrtungStand {
  /** `gps` = vom Tracker übernommen, `manuell` = von Hand gesetzt, `null` = keine Angabe. */
  quelle: 'gps' | 'manuell' | null;
  veraltet: boolean;
  /** „vor 3 min“; nur bei GPS mit lesbarer Messzeit. */
  alterText: string | null;
}

/**
 * Quelle und Alter der Fahrzeugposition. Rein: `jetzt` (ms) kommt vom Aufrufer
 * (`useMinutenTakt`), damit die Marke ohne neuen Abruf mitaltert. Manuelle Positionen altern
 * nie; ohne lesbare Messzeit steht kein geratenes Alter da. Das Alter folgt der Messzeit des
 * Geräts (`position_gemessen_at`), nicht dem Eingang am Server.
 */
export function ortungStand(
  f: Pick<EinsatzFahrzeug, 'position_quelle' | 'position_gemessen_at'>,
  jetzt: number | Date,
): OrtungStand {
  const jetztMs = typeof jetzt === 'number' ? jetzt : jetzt.getTime();
  if (f.position_quelle === 'manuell')
    return { quelle: 'manuell', veraltet: false, alterText: null };
  if (f.position_quelle !== 'ortung') return { quelle: null, veraltet: false, alterText: null };
  const gemessen = f.position_gemessen_at;
  const text = vorText(gemessen, jetztMs);
  if (!gemessen || text === '') return { quelle: 'gps', veraltet: false, alterText: null };
  // Wire-Zeit ohne Zonenkennung ist UTC (wie in `anzeige/dauer.ts`).
  const veraltet = jetztMs - dayjs.utc(gemessen).valueOf() > ORTUNG_VERALTET_NACH_MIN * 60_000;
  return { quelle: 'gps', veraltet, alterText: text };
}
