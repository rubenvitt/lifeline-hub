import type { Person } from '../api/types';
import { hatLuecke } from './personenBilanz';

/**
 * Filterkette und Sichtzustand der Betroffenen-Seite als reine Funktionen. Zwei Achsen plus
 * ein Schalter:
 *
 *  · `ansicht`    — „Zeilen", „Sichtungsraster" oder „Karte". Das Raster gruppiert ALLE
 *                   Personen nach Sichtung (samt „unverletzt" und „ohne Sichtung"), die Karte
 *                   zeigt die Fundorte.
 *  · `filter`     — der Personenstatus, gilt in allen Ansichten.
 *  · `nurLuecken` — Umschalter aus der Seitenleiste „Offene Felder", gilt ebenfalls überall.
 *
 * Die Freitextsuche lebt NICHT hier, sondern im `Datensicht`-Primitiv — ein zweites Suchfeld
 * wäre eine zweite Wahrheit.
 */

/** Statusfilter der Seite. `'alle'` filtert nicht. */
export type PersonenFilter = 'erfasst' | 'vermisst' | 'betroffen' | 'verstorben' | 'alle';

export type PersonenAnsicht = 'zeilen' | 'raster' | 'karte';

export interface PersonenSicht {
  ansicht: PersonenAnsicht;
  filter: PersonenFilter;
  nurLuecken: boolean;
}

/**
 * Vorgabe: Zeilen, ALLE, Lücken-Filter AUS. „Alle", weil eine mit Sichtung erfasste Person
 * serverseitig `betroffen` wird und unter „Neu" beim Erfassen verschwände. Der Lücken-Filter
 * ist eine Einstellung und steht nicht von selbst an.
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
function trifftFilter(p: Pick<Person, 'status'>, filter: PersonenFilter): boolean {
  return filter === 'alle' || p.status === filter;
}

/** Zeilenmenge einer Sicht. Das Raster filtert NICHT nach Sichtung, es GRUPPIERT danach. */
export function filterPersonen(alle: readonly Person[], sicht: PersonenSicht): readonly Person[] {
  return alle.filter((p) => trifftFilter(p, sicht.filter) && (!sicht.nurLuecken || hatLuecke(p)));
}

/**
 * Die Sicht, in der eine gerade erfasste Person SICHTBAR ist — mit so wenig Eingriff wie
 * nötig: ein unpassender Filter fällt auf „Alle", der Lücken-Filter nur, wenn die Person keine
 * Lücke hat. Die Ansicht bleibt (das Raster zeigt jede Person).
 */
export function sichtFuerNeuePerson(sicht: PersonenSicht, p: Person): PersonenSicht {
  const filter = trifftFilter(p, sicht.filter) ? sicht.filter : 'alle';
  const nurLuecken = sicht.nurLuecken && hatLuecke(p);
  if (filter === sicht.filter && nurLuecken === sicht.nurLuecken) return sicht;
  return { ...sicht, filter, nurLuecken };
}

/**
 * Die Sicht nach einem Sprung von außen (Sprungmarken „Patienten"/„Vermisste").
 * Übernommen wird nur, was die Vorgabe nennt. Der Lücken-Filter fällt IMMER: ein stehen
 * gebliebenes „nur offene Felder" zeigte still eine Teilmenge, und der Schalter ist unter `xl`
 * nicht im Blick. Ohne Vorgabe bleibt die Sicht identisch, damit kein Render entsteht.
 */
export function sichtNachSprung(
  sicht: PersonenSicht,
  vorgabe: { filter?: PersonenFilter; ansicht?: PersonenAnsicht },
): PersonenSicht {
  if (!vorgabe.filter && !vorgabe.ansicht) return sicht;
  return {
    ansicht: vorgabe.ansicht ?? sicht.ansicht,
    filter: vorgabe.filter ?? sicht.filter,
    nurLuecken: false,
  };
}

/** Rasterschlüssel einer Person: ihre Sichtung oder `'ohne'`. */
export function rasterSchluessel(p: Pick<Person, 'aktuelle_sichtung'>): string {
  return p.aktuelle_sichtung ?? 'ohne';
}

/**
 * Kandidaten für einen Vermisst-Abgleich: betroffen oder verstorben und nicht storniert — eine
 * stornierte Person stünde sonst unauffällig in der Auswahl.
 */
export function gefundenePersonen(alle: readonly Person[]): readonly Person[] {
  return alle.filter(
    (p) => (p.status === 'betroffen' || p.status === 'verstorben') && !p.storniert_at,
  );
}
