import type { StatusKategorie } from '../api/types';
import { statusKategorie, type StatusDarstellung } from '../theme/statusFarben';
import type { StatusVerteilung } from './kraeftebild';

/**
 * Die EINE Statusachse der Kräfte-Module (Fahrzeuge, Personal, Meldebild, Filterleiste der
 * Kräfteübersicht): „welche Statuskategorie, und wie viele davon?".
 *
 * VIER EIMER, NICHT DREI: `StatusKategorie` hat drei Werte, `status_kategorie` ist aber
 * nullable, und `null` ist der Normalfall einer frisch disponierten Kraft. `'ohne'` ist deshalb
 * ein Eimer, aber NICHT im Vertrag — die Abwesenheit eines Status, Rolle `neutral`.
 *
 * Jedes {@link AmpelFeld} trägt ein `etikett` (Kurztext, sichtbar) und einen `titel` (Volltext):
 * Farbe allein trägt keine Bedeutung (WCAG 1.4.1). Die Abkürzungen bleiben kurz, weil
 * `.lfh-etikett` versal und gesperrt setzt.
 */

/** Statuskategorie ODER die Abwesenheit einer solchen. Vier Eimer, siehe Dateikopf. */
export type KategorieOderOhne = StatusKategorie | 'ohne';

/**
 * Feste Folge der vier Eimer — Gruppen- UND Filterreihenfolge, von verfügbar nach nicht
 * verfügbar, „ohne Status" hinten.
 */
export const KATEGORIE_REIHENFOLGE: readonly KategorieOderOhne[] = [
  'verfuegbar',
  'gebunden',
  'nicht_verfuegbar',
  'ohne',
];

/**
 * „kein Status" als Darstellung. Steht VOR {@link kategorieEtikett}, weil `KATEGORIE_WERTE`
 * beim Modulaufbau schon durch `kategorieEtikett` läuft — später deklariert wäre es ein
 * Laufzeitfehler beim Import.
 */
export const OHNE_STATUS: StatusDarstellung = { rolle: 'neutral', label: 'ohne Status' };

/** Klartext eines Eimers. Ein unbekannter Wert kommt unverändert zurück, nicht als `undefined`. */
export function kategorieEtikett(wert: string): string {
  if (wert === 'ohne') return OHNE_STATUS.label;
  return statusKategorie[wert as StatusKategorie]?.label ?? wert;
}

/**
 * Der Filter-/Gruppenschlüssel einer Zeile — eine Stelle, damit `gruppen.schluessel` und
 * `filter.trifft` nicht auseinanderlaufen.
 */
export function kategorieVon(kat: StatusKategorie | null | undefined): KategorieOderOhne {
  return kat ?? 'ohne';
}

/**
 * Werteliste für `DatensichtSpalte.filter` und für die Filterleiste der Kräfteübersicht.
 * Die drei Vertragslabel kommen aus `statusKategorie`, das vierte aus {@link OHNE_STATUS}.
 */
export const KATEGORIE_WERTE: readonly {
  readonly text: string;
  readonly value: KategorieOderOhne;
}[] = KATEGORIE_REIHENFOLGE.map((value) => ({ value, text: kategorieEtikett(value) }));

/** Ein Zählfeld der Ampelzeile: Kurztext, Volltext, Zahl und optionale Dringlichkeitsstufe. */
interface AmpelFeld {
  /** Sichtbarer Kurztext — der zweite Kanal neben der Farbe. */
  etikett: string;
  /** Volltext für `title`. */
  titel: string;
  wert: number;
  /** Fehlt bei 0 und bei „ohne Status": eine 0 ist keine Dringlichkeit. */
  stufe?: 'alarm' | 'achtung' | 'normal';
}

/**
 * Die vier Zählfelder einer Statusverteilung in FESTER Folge — auch bei 0, damit die Zahlen
 * zweier Zeilen fluchten. `stufe` nur bei `wert > 0`: eine rote 0 meldete das Gegenteil.
 */
export function verteilungFelder(v: StatusVerteilung | null): readonly AmpelFeld[] {
  if (!v) return [];
  const feld = (
    etikett: string,
    titel: string,
    wert: number,
    stufe: AmpelFeld['stufe'],
  ): AmpelFeld => (wert > 0 ? { etikett, titel, wert, stufe } : { etikett, titel, wert });
  return [
    feld('frei', statusKategorie.verfuegbar.label, v.verfuegbar, 'normal'),
    feld('geb.', statusKategorie.gebunden.label, v.gebunden, 'achtung'),
    feld('n.v.', statusKategorie.nicht_verfuegbar.label, v.nicht_verfuegbar, 'alarm'),
    // „ohne Status" bekommt NIE eine Stufe: die Abwesenheit eines Status ist kein Signal.
    feld('o.A.', OHNE_STATUS.label, v.ohne, undefined),
  ];
}
