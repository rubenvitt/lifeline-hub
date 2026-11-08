import { ladeMitglieder } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { Fuehrungsfunktion, MitgliedAnzeige, Sachgebiet } from '../api/types';
import { SACHGEBIETE } from './sachgebiete';

/**
 * Wer welche Führungsfunktion trägt, abgeleitet aus `GET …/mitglieder` (i6k6mzed,
 * `openspec/changes/i6k6mzed-stab-herausnehmen/design.md` D2, D7). Die EINE Zuordnung
 * „Funktion → Name“ im Client: Organigramm, Fernmeldeskizze, Kommunikationsplan, Eigene Lage,
 * Einsatzbericht, Empfängerfelder und Chat-Erwähnungen lesen sie hier. Gepflegt wird die Funktion
 * unter „Mitglieder“ (`pages/MitgliederAbschnitt.tsx`); jedes Mitglied darf die Liste lesen, ein
 * Modulrecht braucht es nicht. Live über das Ereignis `mitglieder`.
 */

/** Die Abfrage der Mitgliederliste, gemeinsamer Cache aller Abnehmer. */
export function mitgliederAbfrage(einsatzId: number) {
  return {
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  };
}

/**
 * Namen alphabetisch, getrennt durch „, “ (Spec `fuehrungsfunktionen`, „Mehrere Mitglieder mit
 * derselben Führungsfunktion“). Dieselbe Folge wie `fuehrung::aufloesung::namensliste` im Server:
 * ohne Groß- und Kleinschreibung, Umlaute wie ihr Grundlaut.
 */
export function namensliste(namen: readonly string[]): string {
  return [...namen]
    .sort(
      (a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0),
    )
    .join(', ');
}

/** Je Führungsfunktion (ganzer Katalog) die Namen ihrer Träger; Funktionen ohne Träger fehlen. */
export function traegerJeFunktion(
  mitglieder: readonly MitgliedAnzeige[] | undefined,
): ReadonlyMap<Fuehrungsfunktion, string> {
  const namen = new Map<Fuehrungsfunktion, string[]>();
  for (const m of mitglieder ?? []) {
    if (!m.fuehrungsfunktion) continue;
    const liste = namen.get(m.fuehrungsfunktion) ?? [];
    liste.push(m.anzeigename);
    namen.set(m.fuehrungsfunktion, liste);
  }
  return new Map([...namen].map(([f, n]) => [f, namensliste(n)]));
}

const IST_SACHGEBIET: ReadonlySet<string> = new Set(SACHGEBIETE.map((s) => s.sachgebiet));

/** Nur die Sachgebiete S1–S6 mit ihren Trägern (Auflösung, Vorschläge, Kommunikationsplan). */
export function besetzungJeSachgebiet(
  mitglieder: readonly MitgliedAnzeige[] | undefined,
): ReadonlyMap<Sachgebiet, string> {
  const karte = new Map<Sachgebiet, string>();
  for (const [f, namen] of traegerJeFunktion(mitglieder)) {
    if (IST_SACHGEBIET.has(f)) karte.set(f as Sachgebiet, namen);
  }
  return karte;
}

export interface SachgebietZeile {
  sachgebiet: Sachgebiet;
  kuerzel: string;
  namen: string;
}

/**
 * Die geführten Sachgebiete in S-Folge (Organigramm, Fernmeldeskizze, Übernahme in den
 * Lagebericht). Ein Sachgebiet ohne Mitglied fehlt; einen Zustand „nicht besetzt“ gibt es nicht
 * (Spec `fuehrungsorganisation`, „Einsatzleitung und Stab“).
 */
export function sachgebietZeilen(
  mitglieder: readonly MitgliedAnzeige[] | undefined,
): SachgebietZeile[] {
  const karte = besetzungJeSachgebiet(mitglieder);
  return SACHGEBIETE.flatMap((s) => {
    const namen = karte.get(s.sachgebiet);
    return namen ? [{ sachgebiet: s.sachgebiet, kuerzel: s.kuerzel, namen }] : [];
  });
}

export interface FunktionZeile {
  funktion: Fuehrungsfunktion;
  kuerzel: string;
  namen: string;
}

/** EL und S1–S7 mit ihren Kürzeln in Katalogfolge. */
const MIT_KUERZEL: readonly (readonly [Fuehrungsfunktion, string])[] = [
  ['el', 'EL'],
  ['s1', 'S1'],
  ['s2', 'S2'],
  ['s3', 'S3'],
  ['s4', 'S4'],
  ['s5', 'S5'],
  ['s6', 'S6'],
  ['s7', 'S7'],
];

/**
 * EL und S1–S7 in Katalogfolge mit den Namen ihrer Träger (Eigene Lage, Einsatzbericht; i6k6mzed,
 * D7). `alle`: auch Funktionen ohne Mitglied, mit leeren Namen; S7 nur, wenn es jemand trägt
 * (S7 schaltet die Organisation ein, LFH-549).
 */
export function fuehrungsfunktionZeilen(
  mitglieder: readonly MitgliedAnzeige[] | undefined,
  alle = false,
): FunktionZeile[] {
  const karte = traegerJeFunktion(mitglieder);
  return MIT_KUERZEL.flatMap(([funktion, kuerzel]) => {
    const namen = karte.get(funktion);
    if (namen) return [{ funktion, kuerzel, namen }];
    return alle && funktion !== 's7' ? [{ funktion, kuerzel, namen: '' }] : [];
  });
}
