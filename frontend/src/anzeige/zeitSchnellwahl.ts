import type { Dayjs } from 'dayjs';
import type { ZeitArt } from './zeitParser';

/**
 * Die EINE Schnellwahl-Tabelle der Zeiteingabe (Spec `zeiteingabe`, „Schnellwahl nach
 * Feldart“; `openspec/changes/ri685cfi-zeiteingabe-tippen-schnellwahl/design.md`, D6). Der
 * Kalender des Bausteins zeigt die Reihe der Feldart, das Feld auf Wunsch ebenso; die
 * ETB-Wiedervorlage (LFH-342 · C7) und die Lagebesprechung (LFH-543) bauen ihre Knöpfe mit
 * eigenem Bezug aus der Frist-Reihe. Gehoben, nicht kopiert: zwei Tabellen mit denselben
 * Beschriftungen liefen auseinander, ohne dass ein Test es bemerkt.
 *
 * Die Beschriftungen sind Bestand und hängen an Tests („+1 h", nicht „+60 min").
 */
export interface SchnellwahlEintrag {
  readonly label: string;
  /** Abstand zum Bezug; 0 = der Bezug selbst („jetzt“). */
  readonly minuten: number;
}

export const SCHNELLWAHL: Readonly<Record<ZeitArt, readonly SchnellwahlEintrag[]>> = {
  ereignis: [
    { label: 'jetzt', minuten: 0 },
    { label: '−5 min', minuten: -5 },
    { label: '−15 min', minuten: -15 },
  ],
  frist: [
    { label: '+15 min', minuten: 15 },
    { label: '+30 min', minuten: 30 },
    { label: '+1 h', minuten: 60 },
    { label: '+2 h', minuten: 120 },
  ],
};

/** Die Frist-Reihe, wie Wiedervorlage und Lagebesprechung sie nennen. */
export const SCHNELLWAHL_TERMIN = SCHNELLWAHL.frist;

/**
 * Die Frist-Einträge zu den genannten Minuten, in Tabellenreihenfolge.
 *
 * Eine unbekannte Minutenzahl ist ein Programmierfehler und wirft: still weggelassen fehlte ein
 * Knopf, ohne dass es jemand bemerkt.
 */
export function schnellwahlAuswahl(minuten: readonly number[]): SchnellwahlEintrag[] {
  const unbekannt = minuten.filter((m) => !SCHNELLWAHL_TERMIN.some((e) => e.minuten === m));
  if (unbekannt.length > 0) {
    throw new Error(`Keine Schnellwahl für ${unbekannt.join(', ')} min`);
  }
  return SCHNELLWAHL_TERMIN.filter((e) => minuten.includes(e.minuten));
}

/**
 * Zeitpunkt = Bezug + Minuten, in echten Minuten (auch über eine Sommerzeitgrenze). Der Bezug ist
 * Sache des Aufrufers: das Feld und die Wiedervorlage rechnen ab jetzt nach Serveruhr, der
 * Abschluss der Lagebesprechung ab dem Zeitpunkt der Besprechung — sonst lehnte das Backend
 * `naechste_at ≤ abgehalten_at` mit 422 ab (`src/routes/lagebesprechung.rs`, `abschliessen`).
 */
export function schnellwahlZeit(bezug: Dayjs, minuten: number): Dayjs {
  return bezug.add(minuten, 'minute');
}
