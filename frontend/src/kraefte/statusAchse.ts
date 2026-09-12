import type { StatusKategorie } from '../api/types';
import { statusKategorie, type StatusDarstellung } from '../theme/statusFarben';
import type { StatusVerteilung } from './kraeftebild';

/**
 * Die EINE Statusachse der Kräfte-Module (LFH-330 · B2, Bündel IV).
 *
 * Vier Seiten stellen dieselbe Frage — Fahrzeuge, Personal, Meldebild und die
 * Filterleiste der Kräfteübersicht: „welche Statuskategorie, und wie viele davon?".
 * Vor diesem Modul stand die Antwort dreimal getrennt im Code: die drei
 * handgeschriebenen Filteroptionen der Kräfteübersicht, die Abkürzungen der
 * Statusspalte und implizit die Gruppenachse, die es noch nicht gab.
 *
 * ── WARUM VIER EIMER UND NICHT DREI ─────────────────────────────────────────────
 *
 * `theme/statusFarben.ts` bildet `StatusKategorie` ab und hat genau DREI Schlüssel —
 * das ist richtig, denn das Enum hat drei Varianten. Die DATEN haben aber vier
 * Zustände: `status_kategorie` ist an beiden DTOs `StatusKategorie | null`, und `null`
 * ist der Normalfall einer frisch disponierten Kraft. Wer nur die drei
 * Vertragswerte gruppiert oder filtert, verliert diese Zeilen lautlos.
 *
 * `'ohne'` ist deshalb hier ein Eimer und NICHT im Vertrag: es ist die ABWESENHEIT
 * eines Status, keine vierte Kategorie. Deshalb trägt {@link OHNE_STATUS} die Rolle
 * `neutral` (kein Signal) und nicht eine der drei Statusrollen.
 *
 * ── WARUM DIE ZAHL EINEN KURZTEXT BRAUCHT ───────────────────────────────────────
 *
 * Die Ampelzeile der Kräfteübersicht codiert über `.lfh-feld--alarm .lfh-zahl` NUR
 * Textfarbe — Farbe allein trägt keine Bedeutung (WCAG 1.4.1, Kriterium 6). Jedes
 * {@link AmpelFeld} führt darum ein `etikett` (Kurztext, sichtbar) UND einen `titel`
 * (Volltext, als `title`-Attribut). Die Abkürzungen bleiben kurz, weil `.lfh-etikett`
 * versal und gesperrt setzt und lange Wörter dort noch breiter werden.
 */

/** Statuskategorie ODER die Abwesenheit einer solchen. Vier Eimer, siehe Dateikopf. */
export type KategorieOderOhne = StatusKategorie | 'ohne';

/**
 * Feste Folge der vier Eimer — Gruppenreihenfolge UND Filterreihenfolge.
 *
 * Von verfügbar nach nicht verfügbar, „ohne Status" hinten: die dringlichste Zeile
 * steht damit nicht am Rand, und die Folge ist über alle vier Seiten dieselbe.
 */
export const KATEGORIE_REIHENFOLGE: readonly KategorieOderOhne[] = [
  'verfuegbar',
  'gebunden',
  'nicht_verfuegbar',
  'ohne',
];

/**
 * „kein Status" als Darstellung. `neutral` heißt: kein Signal, nicht „noch nicht zugeordnet".
 *
 * Steht VOR {@link kategorieEtikett}, weil `KATEGORIE_WERTE` beim Modulaufbau bereits durch
 * `kategorieEtikett` läuft — eine spätere `const` liefe dort in ihre eigene Deklarationslücke
 * und wäre ein Laufzeitfehler beim Import.
 */
export const OHNE_STATUS: StatusDarstellung = { rolle: 'neutral', label: 'ohne Status' };

/** Klartext eines Eimers. Ein unbekannter Wert kommt unverändert zurück, nicht als `undefined`. */
export function kategorieEtikett(wert: string): string {
  if (wert === 'ohne') return OHNE_STATUS.label;
  return statusKategorie[wert as StatusKategorie]?.label ?? wert;
}

/**
 * Der Filter-/Gruppenschlüssel einer Zeile mit optionaler Statuskategorie.
 * EINE Stelle, damit `gruppen.schluessel` und `filter.trifft` nicht auseinanderlaufen.
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
export interface AmpelFeld {
  /** Sichtbarer Kurztext — der zweite Kanal neben der Farbe. */
  etikett: string;
  /** Volltext für `title`. */
  titel: string;
  wert: number;
  /** Fehlt bei 0 und bei „ohne Status": eine 0 ist keine Dringlichkeit. */
  stufe?: 'alarm' | 'achtung' | 'normal';
}

/**
 * Die vier Zählfelder einer Statusverteilung, in FESTER Folge — auch bei 0.
 *
 * Feste Folge, weil zwei übereinanderliegende Zeilen einer Vergleichstabelle nur dann
 * vergleichbar sind, wenn die Zahlen fluchten. Und `stufe` nur bei `wert > 0`, weil
 * eine rot gefärbte 0 das Gegenteil dessen meldet, was sie bedeutet.
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
