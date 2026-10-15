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

/**
 * Die Wörter der Art (D1), die eine Quelle für Spalte und Filter der Stammtabelle
 * (`stammdaten/MaterialTab.tsx`) und, über {@link ART_OPTIONEN}, für das Feld „Art“ im
 * Stammformular und im Ad-hoc-Dialog der Materialliste (LLH-1225 D6): ein Gerät steht je Stück im
 * Einsatz, ein Verbrauchsgut mit Menge.
 */
export const ART_LABEL: Readonly<Record<MaterialArt, string>> = {
  geraet: 'Gerät',
  verbrauchsgut: 'Verbrauchsgut',
};

/** Die Arten als Segmente, in der Folge des Wire-Enums. */
export const ART_OPTIONEN: readonly { wert: MaterialArt; label: string }[] = (
  ['geraet', 'verbrauchsgut'] as const
).map((wert) => ({ wert, label: ART_LABEL[wert] }));

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

/** Der Rest eines Verbrauchsguts als Text: „30 von 50 übrig“, auch „50 von 50 übrig“. */
export function restText(em: Pick<EinsatzMaterial, 'menge' | 'ausgegeben'>): string {
  return `${em.menge - em.ausgegeben} von ${em.menge} übrig`;
}

/** Menge als Text: Gerät „1“, Verbrauchsgut „50“, mit Ausgabe „30 von 50 übrig“. */
export function mengeText(em: Zeile): string {
  if (em.art === 'geraet') return '1';
  if (em.ausgegeben <= 0) return String(em.menge);
  return restText(em);
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

/** Das Feld des PATCH/POST je Ortsart, benannt wie im DTO (LLH-1224 D7). */
export const ORT_FELD = {
  einheit: 'einheit_id',
  fahrzeug: 'einsatz_fahrzeug_id',
  uhs: 'uhs_id',
  bereitstellungsraum: 'br_id',
} as const satisfies Record<MaterialOrtArt, keyof OrtSpalten>;

type OrtFeld = (typeof ORT_FELD)[MaterialOrtArt];

/**
 * Der Körper eines Ortswechsels (LLH-1225 D2), die eine Stelle, die ihn baut: Ziel gleich vorher →
 * `null` (nichts senden); Ziel gesetzt → nur sein Feld, der Server löst den bisherigen Ort in
 * derselben Anfrage; Ziel leer → das Feld des bisherigen Orts auf `null`.
 */
export function ortPatch(
  ziel: MaterialOrtRef | null,
  vorher: MaterialOrtRef | null,
): Partial<Record<OrtFeld, number | null>> | null {
  if (ziel == null) return vorher == null ? null : { [ORT_FELD[vorher.art]]: null };
  if (vorher != null && vorher.art === ziel.art && vorher.id === ziel.id) return null;
  return { [ORT_FELD[ziel.art]]: ziel.id };
}

/** Präfix je Ortsart im Auswahlwert; die IDs der Ortsarten kollidieren (`einheit:3`, `uhs:3`). */
const WERT_PRAEFIX: Record<MaterialOrtArt, string> = {
  einheit: 'einheit',
  fahrzeug: 'fahrzeug',
  uhs: 'uhs',
  bereitstellungsraum: 'br',
};
/** Auswahl- und Filterwert für „ohne Ort“. */
export const OHNE_ORT_WERT = 'ohne';

/** Der Ort als Auswahlwert: `einheit:12`, `fahrzeug:3`, `uhs:4`, `br:2`, ohne Ort `ohne`. */
export function toOrtValue(ort: MaterialOrtRef | null): string {
  return ort == null ? OHNE_ORT_WERT : `${WERT_PRAEFIX[ort.art]}:${ort.id}`;
}

/** Umkehrung von {@link toOrtValue}; Unbekanntes ist `undefined`, nie still „ohne Ort“. */
export function parseOrtValue(wert: string): MaterialOrtRef | null | undefined {
  if (wert === OHNE_ORT_WERT) return null;
  const treffer = /^([a-z]+):([1-9][0-9]*)$/.exec(wert);
  if (!treffer) return undefined;
  const art = (Object.keys(WERT_PRAEFIX) as MaterialOrtArt[]).find(
    (a) => WERT_PRAEFIX[a] === treffer[1],
  );
  return art ? { art, id: Number(treffer[2]) } : undefined;
}

/**
 * Der Ort-Auswahlwert als Feld des POST (LLH-1225 D7): „ohne Ort“ und Unbekanntes senden keins.
 * Disponier-Dialoge der Materialliste und die Übernahme aus einer Nachforderung (LLH-1226) bauen
 * den Körper hierüber.
 */
export function ortPostFields(
  wert: string | undefined,
): Partial<Record<OrtFeld, number | null>> | undefined {
  const ziel = wert ? parseOrtValue(wert) : undefined;
  return ziel ? (ortPatch(ziel, null) ?? undefined) : undefined;
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
