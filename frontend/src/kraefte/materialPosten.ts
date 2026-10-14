import type { EinsatzMaterial, MaterialArt, MaterialStatus } from '../api/types';
import { materialStatus, type StatusDarstellung } from '../theme/statusFarben';

/**
 * Was aus EINER Material-Zeile folgt (LLH-1224, design.md D15), rein und an einer Stelle: ob ein
 * Verbrauchsgut aufgebraucht ist, wie der Status erscheint, welche Status die Art kennt, wie die
 * Menge geschrieben wird und wo der Posten liegt. Materialliste, UHS-Reiter, Meldebild,
 * Verdichtung und die Ansichten aus LLH-1225/1226 lesen von hier; die Wörter „ohne Ort“,
 * „aufgebraucht“ und „30 von 50 übrig“ stehen nur hier.
 */

type Zeile = Pick<EinsatzMaterial, 'art' | 'menge' | 'ausgegeben'>;

/** Ein Verbrauchsgut, dessen ganze Menge ausgegeben ist (D4). Ein Gerät ist es nie. */
export function isAufgebraucht(em: Zeile): boolean {
  return em.art === 'verbrauchsgut' && em.ausgegeben >= em.menge;
}

/** Darstellung im Text eines aufgebrauchten Postens. */
export const AUFGEBRAUCHT = 'aufgebraucht';

/**
 * Status-Darstellung eines Postens: der Vertrag `materialStatus` (`theme/statusFarben.ts`); ein
 * aufgebrauchtes Verbrauchsgut trägt die Darstellung von „verbraucht“ mit dem Wort
 * „aufgebraucht“ — keine eigene Karte (`frontend/AGENTS.md`, „Ein Status gehört in den Vertrag“).
 */
export function materialDarstellung(
  em: Zeile & Pick<EinsatzMaterial, 'status'>,
): StatusDarstellung {
  if (isAufgebraucht(em)) return { ...materialStatus.verbraucht, label: AUFGEBRAUCHT };
  return materialStatus[em.status];
}

const ALLE_STATUS: readonly MaterialStatus[] = [
  'einsatzbereit',
  'im_einsatz',
  'defekt',
  'verbraucht',
  'desinfektion_noetig',
];

/** Nur ein Gerät kennt „verbraucht“ und „Desinfektion nötig“ (D3); der Server prüft dasselbe. */
const NUR_GERAET: ReadonlySet<MaterialStatus> = new Set(['verbraucht', 'desinfektion_noetig']);

/** Die Status, die eine Zeile dieser Art annehmen darf, in der Folge des Vertrags. */
export function materialStatusOptionen(art: MaterialArt): MaterialStatus[] {
  return ALLE_STATUS.filter((s) => art === 'geraet' || !NUR_GERAET.has(s));
}

/** Menge als Text: Gerät „1“, Verbrauchsgut „50“, mit Ausgabe „30 von 50 übrig“. */
export function mengeText(em: Zeile): string {
  if (em.art === 'geraet') return '1';
  if (em.ausgegeben <= 0) return String(em.menge);
  return `${em.menge - em.ausgegeben} von ${em.menge} übrig`;
}

export type MaterialOrtArt = 'einheit' | 'fahrzeug' | 'uhs' | 'bereitstellungsraum';

/** Der eine Ort eines Postens (D6); `null` heißt „ohne Ort“. */
export interface MaterialOrtRef {
  art: MaterialOrtArt;
  id: number;
}

type OrtSpalten = Partial<
  Pick<EinsatzMaterial, 'einheit_id' | 'einsatz_fahrzeug_id' | 'uhs_id' | 'br_id'>
>;

/**
 * Der Ort aus der Zeile — die eine Lesestelle der vier Spalten. Der Server lässt höchstens eine
 * gesetzt (CHECK); stünden doch zwei, gälte die erste in der Folge Einheit, Fahrzeug, UHS, BR.
 */
export function ortVon(em: OrtSpalten): MaterialOrtRef | null {
  if (em.einheit_id != null) return { art: 'einheit', id: em.einheit_id };
  if (em.einsatz_fahrzeug_id != null) return { art: 'fahrzeug', id: em.einsatz_fahrzeug_id };
  if (em.uhs_id != null) return { art: 'uhs', id: em.uhs_id };
  if (em.br_id != null) return { art: 'bereitstellungsraum', id: em.br_id };
  return null;
}

/**
 * Namen je Ortsart, die der Aufrufer aus seinen Listen auflöst: Einheit → Name, Fahrzeug →
 * Funkrufname, UHS → Bezeichnung, Bereitstellungsraum → Bezeichnung. Eine fehlende Funktion heißt
 * „ohne Leserecht“; `undefined` heißt „unbekannt“.
 */
export type OrtNamen = Partial<Record<MaterialOrtArt, (id: number) => string | undefined>>;

export const OHNE_ORT = 'ohne Ort';
/** Steht ein Ort fest, aber sein Name nicht (kein Leserecht, nicht geladen): nie „—“ (1093 D2). */
export const ZUGEORDNET = 'zugeordnet';

/** Anzeigename einer UHS: „UHS Turnhalle“; heißt sie schon „UHS …“, nicht doppelt. */
export function uhsName(u: { bezeichnung: string }): string {
  return /^UHS\b/i.test(u.bezeichnung) ? u.bezeichnung : `UHS ${u.bezeichnung}`;
}

/** Der Ort als Text: Name des Orts, „ohne Ort“ oder „zugeordnet“. */
export function ortText(ort: MaterialOrtRef | null, namen: OrtNamen): string {
  if (ort == null) return OHNE_ORT;
  const name = namen[ort.art]?.(ort.id);
  if (name == null) return ZUGEORDNET;
  return ort.art === 'uhs' ? uhsName({ bezeichnung: name }) : name;
}
