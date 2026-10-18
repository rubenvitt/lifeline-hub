import type { KoerperRegion, Person, Verletzung, VerletzungAnsicht } from '../../api/types';
import type { Figur } from './geometrie';

/**
 * Reiner Kern des Körperschemas (LLH-1120, Spec `koerperschema`, design.md D13): Namen der
 * Regionen, feste Nummerierung und die Wahl der Figur. Die Zeichnung (`geometrie.ts`) und der
 * Baustein (`personen/Koerperschema.tsx`) lesen nur von hier; Patientenkopf, Druck und Liste
 * nennen eine Verletzung mit demselben Namen.
 */

/** Region mit Seite aus Sicht des Patienten, wie sie an der Trage gesagt wird. */
export const REGION_WORT: Record<KoerperRegion, string> = {
  kopf: 'Kopf',
  gesicht: 'Gesicht',
  hals: 'Hals',
  thorax: 'Thorax',
  abdomen: 'Abdomen',
  becken: 'Becken',
  ruecken: 'Rücken',
  wirbelsaeule: 'Wirbelsäule',
  gesaess: 'Gesäß',
  oberarm_l: 'Oberarm links',
  oberarm_r: 'Oberarm rechts',
  unterarm_l: 'Unterarm links',
  unterarm_r: 'Unterarm rechts',
  hand_l: 'Hand links',
  hand_r: 'Hand rechts',
  oberschenkel_l: 'Oberschenkel links',
  oberschenkel_r: 'Oberschenkel rechts',
  unterschenkel_l: 'Unterschenkel links',
  unterschenkel_r: 'Unterschenkel rechts',
  fuss_l: 'Fuß links',
  fuss_r: 'Fuß rechts',
};

export const ANSICHT_WORT: Record<VerletzungAnsicht, string> = {
  vorn: 'vorn',
  hinten: 'hinten',
};

/** Der zugängliche Name einer Region: Region, Seite und Ansicht („Unterarm links, vorn“). */
export function regionName(ansicht: VerletzungAnsicht, region: KoerperRegion): string {
  return `${REGION_WORT[region]}, ${ANSICHT_WORT[ansicht]}`;
}

/** Eine Verletzung mit ihrer festen Nummer am Schema. */
export interface NummerierteVerletzung {
  nummer: number;
  verletzung: Verletzung;
}

/**
 * Die Nummer folgt fest der Erfassungsfolge über ALLE Markierungen, auch die aufgehobenen
 * (Spec, „Liste als zweiter Kanal“): ein Aufheben zählt nicht neu, es bleibt eine Lücke. Die
 * Folge ist die Kennung (der Server vergibt sie aufsteigend, `ORDER BY id`), nicht die
 * Erfassungszeit: eine nachgereichte ältere Markierung bekommt die nächste Nummer, sonst
 * sprängen die Nummern unter den Augen der Leser.
 */
export function nummeriere(verletzungen: readonly Verletzung[]): NummerierteVerletzung[] {
  return [...verletzungen]
    .sort((a, b) => a.id - b.id)
    .map((verletzung, i) => ({ nummer: i + 1, verletzung }));
}

/**
 * Die Figur aus dem Geschlecht der Person (Spec, „Figur nach Geschlecht, Lage unabhängig davon“):
 * männlich und weiblich je eigene, sonst (divers, unbekannt, ohne Angabe) die neutrale.
 */
export function figurVon(geschlecht: Person['geschlecht'] | undefined): Figur {
  return geschlecht === 'maennlich' || geschlecht === 'weiblich' ? geschlecht : 'neutral';
}
