import type { Person } from '../api/types';
import { hatLuecke } from './personenBilanz';

/**
 * Filterkette und Sichtzustand der Betroffenen-Seite als reine Funktionen (LFH-330 · B2,
 * Muster `pages/schaeden/schadenHelfer.tsx`; Neuentwurf S7).
 *
 * ── ZWEI ACHSEN STATT SECHS REITER ──────────────────────────────────────────────────────
 *
 * Bis zum Neuentwurf standen sechs Reiter nebeneinander — fünf davon Statusfilter, einer
 * („Patienten") eine ANDERE DARSTELLUNG (nach Sichtung gruppiert). Zwei Achsen in einer
 * Reiterleiste verwischten, welche von beiden gerade die Zeilen bestimmt. Jetzt:
 *
 *  · `ansicht`    — „Zeilen" oder „Sichtungsraster" (Segmentleiste im Seitenkopf). Das
 *                   Raster ist die verallgemeinerte Patienten-Gruppierung: ALLE Personen
 *                   nach Sichtung, samt „unverletzt" und „ohne Sichtung".
 *  · `filter`     — der Personenstatus (Neu/Vermisst/Betroffen/Verstorben/Alle), als
 *                   zweite Leiste über der Tabelle. Gilt in BEIDEN Ansichten.
 *  · `nurLuecken` — Umschalter aus der Seitenleiste „Offene Felder". Gilt ebenfalls in
 *                   beiden Ansichten.
 *
 * Was hier NICHT lebt: die Freitextsuche. Sie hängt am `suchText` der Spalten und läuft im
 * `Datensicht`-Primitiv — ein zweites Suchfeld auf der Seite wäre eine zweite, still
 * driftende Wahrheit.
 */

/** Statusfilter der Seite. `'alle'` filtert nicht. */
export type PersonenFilter = 'erfasst' | 'vermisst' | 'betroffen' | 'verstorben' | 'alle';

export type PersonenAnsicht = 'zeilen' | 'raster';

export interface PersonenSicht {
  ansicht: PersonenAnsicht;
  filter: PersonenFilter;
  nurLuecken: boolean;
}

/**
 * Vorgabe: Zeilen, ALLE, Lücken-Filter AUS. „Alle" statt des früheren „Neu": wer über die
 * Zeile eine Person MIT Sichtung erfasst, bekommt serverseitig `betroffen` — unter „Neu"
 * verschwände sie im Moment des Erfassens. Der Lücken-Filter ist eine Einstellung, und
 * eine Einstellung, die von selbst ansteht, ist benutzt worden, ohne gewählt worden zu
 * sein (CLAUDE.md, „Werte behalten").
 */
export const SICHT_VORGABE: PersonenSicht = {
  ansicht: 'zeilen',
  filter: 'alle',
  nurLuecken: false,
};

export const FILTER_OPTIONEN: readonly { wert: PersonenFilter; label: string }[] = [
  { wert: 'alle', label: 'Alle' },
  { wert: 'erfasst', label: 'Neu' },
  { wert: 'vermisst', label: 'Vermisst' },
  { wert: 'betroffen', label: 'Betroffen' },
  { wert: 'verstorben', label: 'Verstorben' },
];

/** Trifft der Statusfilter die Person? */
export function trifftFilter(p: Pick<Person, 'status'>, filter: PersonenFilter): boolean {
  return filter === 'alle' || p.status === filter;
}

/**
 * Zeilenmenge einer Sicht. Das Raster filtert NICHT nach Sichtung — es GRUPPIERT danach
 * (`Datensicht.gruppen`); ungesichtete Personen stehen dort in „ohne Sichtung".
 */
export function filterPersonen(alle: readonly Person[], sicht: PersonenSicht): readonly Person[] {
  return alle.filter((p) => trifftFilter(p, sicht.filter) && (!sicht.nurLuecken || hatLuecke(p)));
}

/**
 * Die Sicht, in der eine gerade erfasste Person SICHTBAR ist — ohne die Wahl der Person
 * mehr zu verbiegen als nötig. Jede Achse wird nur zurückgenommen, wenn sie die neue Zeile
 * verbirgt: ein passender Filter bleibt stehen, ein unpassender fällt auf „Alle"; der
 * Lücken-Filter fällt nur, wenn die Person keine Lücke hat. Die Ansicht bleibt — das
 * Raster zeigt jede Person (auch ohne Sichtung).
 *
 * Vorher sprang die Seite fest in einen Reiter; bei einer Person mit Erst-Sichtung, die der
 * Server von `erfasst` auf `betroffen` hebt, war das der falsche, und die Hervorhebung
 * stand an einer Zeile, die gar nicht angezeigt wurde.
 */
export function sichtFuerNeuePerson(sicht: PersonenSicht, p: Person): PersonenSicht {
  const filter = trifftFilter(p, sicht.filter) ? sicht.filter : 'alle';
  const nurLuecken = sicht.nurLuecken && hatLuecke(p);
  if (filter === sicht.filter && nurLuecken === sicht.nurLuecken) return sicht;
  return { ...sicht, filter, nurLuecken };
}

/** Rasterschlüssel einer Person: ihre Sichtung oder `'ohne'`. */
export function rasterSchluessel(p: Pick<Person, 'aktuelle_sichtung'>): string {
  return p.aktuelle_sichtung ?? 'ohne';
}

/**
 * Die für einen Vermisst-Abgleich in Frage kommenden Personen: betroffen oder verstorben,
 * und nicht storniert.
 *
 * `!p.storniert_at` ist nicht Beiwerk — eine stornierte Person darf als Abgleichsziel nicht
 * angeboten werden, und ohne diese Bedingung stünde sie unauffällig in der Auswahlliste.
 */
export function gefundenePersonen(alle: readonly Person[]): readonly Person[] {
  return alle.filter(
    (p) => (p.status === 'betroffen' || p.status === 'verstorben') && !p.storniert_at,
  );
}
