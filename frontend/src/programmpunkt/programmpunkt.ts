/**
 * Lesart der Programmpunkte (LLH-1570, Spec `ablaufplan`). Rein, mit der Uhr als Argument. Ein
 * Programmpunkt ist eine Erwartung, keine Frist: mit seinem Zeitpunkt ist er verstrichen, nie
 * „überfällig“. Wire-Zeit ist UTC ohne Zone und wird nur über `dayjs.utc` gelesen.
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Programmpunkt } from '../api/types';

dayjs.extend(utc);

function zeitpunktMs(p: Pick<Programmpunkt, 'zeitpunkt_at'>): number | null {
  const d = dayjs.utc(p.zeitpunkt_at);
  return d.isValid() ? d.valueOf() : null;
}

/** Erreicht oder vorbei? Ein unlesbarer Zeitpunkt gilt als verstrichen (er stünde sonst ewig da). */
export function istVerstrichen(p: Pick<Programmpunkt, 'zeitpunkt_at'>, jetzt: Dayjs): boolean {
  const ms = zeitpunktMs(p);
  return ms == null || ms <= jetzt.valueOf();
}

/** Die nächsten `anzahl` anstehenden Programmpunkte, aufsteigend (Lagemonitor, design.md D4). */
export function anstehendeProgrammpunkte(
  punkte: readonly Programmpunkt[],
  jetzt: Dayjs,
  anzahl: number,
): Programmpunkt[] {
  return punkte
    .filter((p) => !istVerstrichen(p, jetzt))
    .sort((a, b) => zeitpunktMs(a)! - zeitpunktMs(b)! || a.id - b.id)
    .slice(0, anzahl);
}
