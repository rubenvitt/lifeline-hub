import type { Einheit, Einsatzabschnitt } from '../api/types';
import { einheitenBaum, filterAktive, type EinheitKnoten } from './kraeftebaumKern';

/**
 * Einheit-Optionen der geteilten Auswahl `EinheitAngabe` (Entscheidung 13.10.2026, Nachtrag
 * 22:10), rein. LLH-1060 führt dieselben Bausteine in `einteilungKern.ts`; wer zuletzt merged,
 * führt beide Stellen zusammen.
 *
 * EINE BAUMLOGIK (`frontend/AGENTS.md`, „Eine Baumlogik der Kräfte“): Folge und Pfad kommen aus
 * {@link einheitenBaum}; hier wird nur abgebildet.
 */

/** Trenner im Pfad einer Untereinheit („Zug 1 › Staffel A“). */
export const PFAD_TRENNER = ' › ';

/** Eine Einheit als Auswahlwert: Pfad als Etikett, Tiefe für den Einzug. */
export interface EinheitOption {
  id: number;
  name: string;
  /** Name samt Vorfahren („Zug 1 › Staffel A“); bei einer Wurzel der Name. */
  pfad: string;
  /** 0 = oberste Einheit. */
  tiefe: number;
}

/**
 * Die Einheiten in der Folge des Kräftebaums (Tiefensuche, Geschwister nach Abschnittsrang, dann
 * Eingabefolge), je mit Pfad. Ohne Abschnitte gilt die Eingabefolge. Eine aufgelöste Einheit steht
 * nicht zur Wahl (LLH-1079).
 */
export function buildEinheitOptions(
  einheiten: readonly Einheit[],
  abschnitte: readonly Einsatzabschnitt[],
): EinheitOption[] {
  const ergebnis: EinheitOption[] = [];
  const besuche = (knoten: EinheitKnoten, vorfahren: readonly string[]) => {
    const pfad = [...vorfahren, knoten.einheit.name];
    ergebnis.push({
      id: knoten.einheit.id,
      name: knoten.einheit.name,
      pfad: pfad.join(PFAD_TRENNER),
      tiefe: vorfahren.length,
    });
    for (const kind of knoten.kinder) besuche(kind, pfad);
  };
  for (const wurzel of einheitenBaum(filterAktive(einheiten), abschnitte)) besuche(wurzel, []);
  return ergebnis;
}
