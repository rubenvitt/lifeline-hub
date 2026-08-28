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

/** „Jetzt" in der Anzeigezone — dieselbe Zone, in der `tagesSchluessel` den Tag bestimmt. */
export function jetztInZone(konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN, jetzt: Dayjs = dayjs()): Dayjs {
  if (!konv.zeitzone) return jetzt;
  try {
    return jetzt.tz(konv.zeitzone);
  } catch {
    return jetzt;
  }
}

/**
 * Gruppenetikett: „Heute" / „Gestern" / `DD.MM.YYYY`. Nimmt die KONVENTIONEN, nicht ein
 * `jetzt` — damit der Aufrufer die Zone nicht vergessen kann (Review LFH-348: der einzige
 * Produktivaufrufer reichte kein `jetzt` durch, „Heute" fiel bei abweichender Anzeigezone
 * auf den falschen Tageskopf). Der Schlüssel `YYYY-MM-DD` ist zonenlos; verglichen wird er
 * mit dem heutigen Schlüssel derselben Zone, nicht mit einem Zeitpunkt.
 */
export function tagesEtikett(
  schluessel: string,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
  jetzt: Dayjs = dayjs(),
): string {
  const heute = jetztInZone(konv, jetzt);
  if (schluessel === heute.format('YYYY-MM-DD')) return 'Heute';
  if (schluessel === heute.subtract(1, 'day').format('YYYY-MM-DD')) return 'Gestern';
  return dayjs(schluessel, 'YYYY-MM-DD').format('DD.MM.YYYY');
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
      return d.isSame(jetztInZone(konv, jetzt), 'day');
  }
}
