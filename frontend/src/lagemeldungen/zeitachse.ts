import dayjs, { type Dayjs } from 'dayjs';
import { DEFAULT_KONVENTIONEN, inZone, type AnzeigeKonventionen } from '../anzeige/format';

/**
 * Zeitachse der Lagemeldungen (LFH-348 · C13, Befund M85): Tagesgruppen und Zeitfenster —
 * rein, ohne React, damit die Tagesgrenze ohne Render prüfbar ist.
 *
 * Der Wire-String ist UTC OHNE Zonenkennung; `dayjs(s)` läse ihn als Ortszeit und
 * verschöbe die Tagesgrenze um den Zonenversatz (dieselbe Falle wie in `etb/filterZeit.ts`).
 * Deshalb läuft alles über `inZone` aus `anzeige/format.ts` — dieselbe Zone, in der
 * `ZeitAnzeige` daneben die Uhrzeit rendert; sonst stünde ein 00:30-Eintrag unter dem
 * falschen Tageskopf.
 */

export type Zeitfenster = 'stunde' | 'vierStunden' | 'heute';

export const ZEITFENSTER: readonly { readonly text: string; readonly value: Zeitfenster }[] = [
  { text: 'Letzte Stunde', value: 'stunde' },
  { text: 'Letzte 4 Stunden', value: 'vierStunden' },
  { text: 'Heute', value: 'heute' },
];

/** Gruppenschlüssel: das Datum in der Anzeigezone, `YYYY-MM-DD` — sortierbar als Text. */
export function tagesSchluessel(utc: string, konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN): string {
  return inZone(utc, konv).format('YYYY-MM-DD');
}

/** Gruppenetikett: „Heute" / „Gestern" / `DD.MM.YYYY`. `jetzt` in derselben Zone wie der Schlüssel. */
export function tagesEtikett(schluessel: string, jetzt: Dayjs = dayjs()): string {
  const tag = dayjs(schluessel, 'YYYY-MM-DD');
  if (tag.isSame(jetzt, 'day')) return 'Heute';
  if (tag.isSame(jetzt.subtract(1, 'day'), 'day')) return 'Gestern';
  return tag.format('DD.MM.YYYY');
}

/** Trifft der Zeitpunkt in das Fenster? Grenzen einschließend (59 min drin, 61 min draußen). */
export function imZeitfenster(
  utc: string,
  fenster: Zeitfenster,
  jetzt: Dayjs = dayjs(),
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): boolean {
  const d = inZone(utc, konv);
  switch (fenster) {
    case 'stunde':
      return !d.isBefore(jetzt.subtract(1, 'hour'));
    case 'vierStunden':
      return !d.isBefore(jetzt.subtract(4, 'hour'));
    case 'heute':
      return d.isSame(konv.zeitzone ? jetzt.tz(konv.zeitzone) : jetzt, 'day');
  }
}
