import type { EinheitTyp, Nachforderung } from '../api/types';

/**
 * Vorschläge für „Was“ einer Nachforderung (LLH-1089, design.md D2–D4) — rein.
 *
 * Gebaut mit dem heutigen Muster (`AutoComplete` mit gruppierten Optionen, wie
 * `stammdaten/externeStellenVorschlaege.ts`). Kommt der Baustein Stammdaten-Vorschlagsfeld
 * (LLH-1022 j, `StammdatenFeld`), zieht nur diese Datei um.
 */

/**
 * Gängige Kräfte und Mittel aus der Praxis von Feuerwehr, Rettungsdienst und
 * Katastrophenschutz. Die Folge ist zugleich die Auffüllfolge der Schnellwahl.
 */
export const GAENGIGE_ARTEN: readonly string[] = [
  'RTW',
  'KTW',
  'NEF',
  'LF 10',
  'HLF 20',
  'DLK 23-12',
  'TLF',
  'ELW 1',
  'GW-L2',
  'Einsatzeinheit',
  'Betreuungszug',
  'Sanitätszug',
  'SEG Transport',
  'SEG Verpflegung',
  'Sandsäcke',
  'Tauchpumpe',
];

/** Zahl der Knöpfe der Schnellwahl. */
export const SCHNELLWAHL_ANZAHL = 6;

const schluessel = (art: string) => art.trim().toLocaleLowerCase('de');

/**
 * Die Arten des Einsatzes nach Häufigkeit, bei Gleichstand die zuletzt angeforderte zuerst.
 * Gleich ist, was sich nur in Groß-/Kleinschreibung oder Leerraum am Rand unterscheidet; es
 * steht in der Schreibweise der jüngsten Anforderung.
 */
export function fruehereArten(
  liste: ReadonlyArray<Pick<Nachforderung, 'art' | 'angefordert_at' | 'id'>>,
): string[] {
  const je = new Map<string, { art: string; zahl: number; zuletzt: string; id: number }>();
  for (const n of liste) {
    const art = n.art.trim();
    if (!art) continue;
    const k = schluessel(art);
    const bisher = je.get(k);
    if (!bisher) {
      je.set(k, { art, zahl: 1, zuletzt: n.angefordert_at, id: n.id });
      continue;
    }
    bisher.zahl += 1;
    const juenger =
      n.angefordert_at > bisher.zuletzt ||
      (n.angefordert_at === bisher.zuletzt && n.id > bisher.id);
    if (juenger) {
      bisher.art = art;
      bisher.zuletzt = n.angefordert_at;
      bisher.id = n.id;
    }
  }
  return [...je.values()]
    .sort((a, b) => b.zahl - a.zahl || b.zuletzt.localeCompare(a.zuletzt) || b.id - a.id)
    .map((e) => e.art);
}

/** Die Schnellwahl: die häufigsten Arten des Einsatzes, aufgefüllt aus {@link GAENGIGE_ARTEN}. */
export function schnellwahlArten(
  frueher: readonly string[],
  anzahl: number = SCHNELLWAHL_ANZAHL,
): string[] {
  return entdoppelt([...frueher, ...GAENGIGE_ARTEN]).slice(0, anzahl);
}

export interface ArtOption {
  value: string;
  label: string;
}

export interface ArtGruppe {
  label: string;
  options: ArtOption[];
}

/**
 * Gruppierte Optionen für „Was“: „In diesem Einsatz“, „Einheitstypen“ (Folge des Katalogs),
 * „Kräfte und Mittel“. Entdoppelt ohne Groß-/Kleinschreibung, die erste Gruppe gewinnt; leere
 * Gruppen fallen weg.
 */
export function artOptionen(
  frueher: readonly string[],
  einheitTypen: ReadonlyArray<Pick<EinheitTyp, 'label' | 'sortier'>>,
): ArtGruppe[] {
  const gesehen = new Set<string>();
  const gruppe = (label: string, arten: readonly string[]): ArtGruppe => ({
    label,
    options: arten.flatMap((art) => {
      const a = art.trim();
      const k = schluessel(a);
      if (!a || gesehen.has(k)) return [];
      gesehen.add(k);
      return [{ value: a, label: a }];
    }),
  });
  const typen = [...einheitTypen].sort((a, b) => a.sortier - b.sortier).map((t) => t.label);
  return [
    gruppe('In diesem Einsatz', frueher),
    gruppe('Einheitstypen', typen),
    gruppe('Kräfte und Mittel', GAENGIGE_ARTEN),
  ].filter((g) => g.options.length > 0);
}

function entdoppelt(arten: readonly string[]): string[] {
  const gesehen = new Set<string>();
  return arten.filter((a) => {
    const k = schluessel(a);
    if (!a.trim() || gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  });
}
