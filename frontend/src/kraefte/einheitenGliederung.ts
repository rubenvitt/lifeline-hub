import type { Einheit, Einsatzabschnitt, Staerke } from '../api/types';
import type { EinheitStaerkeUrteil } from '../theme/statusFarben';
import {
  COLLATOR,
  einheitStaerkeUrteilVon,
  einheitenBaum,
  filterAktive,
  type EinheitKnoten,
} from './kraeftebaumKern';
import type { TzEinheit } from './meldebildRaster';

/**
 * Die Einheiten-Gliederung als Zeilen (LLH-1029): dieselbe Einheit-Hierarchie wie das Meldebild,
 * abgebildet aus dem EINEN Kräftebaum-Kern (`kraeftebaumKern.ts`, `einheitenBaum`), nicht neu
 * gebaut. Nur Einheiten, keine Mittel: die Seite fragt „welche Einheit?“, das Meldebild „wie steht
 * jede Kraft da?“. Knotenfolge und Schlüssel (`eh-<id>`) gleichen den Einheitenzeilen des
 * Meldebilds; `einheitenGliederung.test.ts` pinnt das gegen `baueMeldebildRaster`.
 *
 * IST VOM SERVER (Entscheidung LLH-1029): `ist_kumuliert` je Zeile — dieselbe Zahl wie auf der
 * Einheit-Ansicht, in den Abschnitten und in `summiereStaerke`. Die Form gleicht dem Meldebild
 * (Eltern = eigen + Σ Untereinheiten, jedes Kind seine Teilsumme), die Zählregel ist die des
 * Servers. Rein.
 */

export interface GliederungZeile {
  key: string;
  art: 'einheit';
  einheitId: number;
  bezeichnung: string;
  /** Typ der Einheit — Nebentext unter dem Namen. */
  zusatz: string | null;
  tz: TzEinheit;
  fuehrer: string | null;
  /** Kumulierte Ist-Stärke des Servers (eigen + alle unterstellten). */
  ist: Staerke;
  soll: Staerke | null;
  /** Ist kumuliert gegen Soll, je Achse (`einheitStaerkeUrteilVon`). */
  urteil: EinheitStaerkeUrteil;
  /** Der eigene Abschnitt, sonst der geerbte der Obereinheit (wie im Meldebild). */
  abschnitt: string | null;
  /** Funkrufnamen der Fahrzeuge der Einheit, natürlich sortiert. */
  fahrzeuge: string[];
  children?: GliederungZeile[];
}

export function buildEinheitenGliederung(
  einheiten: readonly Einheit[],
  abschnitte: readonly Einsatzabschnitt[],
): GliederungZeile[] {
  // Namen aus der Abschnittsliste, sonst aus der Einheit, die den Abschnitt trägt: ohne Leserecht
  // auf die Abschnitte bliebe die Spalte sonst für jede Untereinheit leer.
  const abschnittName = new Map<number, string>();
  for (const e of einheiten)
    if (e.abschnitt_id != null && e.abschnitt_name)
      abschnittName.set(e.abschnitt_id, e.abschnitt_name);
  for (const a of abschnitte) abschnittName.set(a.id, a.name);

  const zeile = (k: EinheitKnoten): GliederungZeile => {
    const x = k.einheit;
    const kinder = k.kinder.map(zeile);
    return {
      key: `eh-${x.id}`,
      art: 'einheit',
      einheitId: x.id,
      bezeichnung: x.name,
      zusatz: x.typ_label ?? null,
      tz: {
        typLabel: x.typ_label ?? null,
        fachaufgabe: x.tz_fachaufgabe ?? null,
        organisation: x.tz_organisation ?? null,
      },
      fuehrer: x.fuehrer_name ?? null,
      ist: x.ist_kumuliert,
      soll: x.soll ?? null,
      urteil: einheitStaerkeUrteilVon(x.ist_kumuliert, x.soll ?? null),
      abschnitt: k.abschnittId != null ? (abschnittName.get(k.abschnittId) ?? null) : null,
      fahrzeuge: (x.fahrzeug_mitglieder ?? [])
        .map((f) => f.funkrufname)
        .sort((a, b) => COLLATOR.compare(a, b)),
      ...(kinder.length > 0 ? { children: kinder } : {}),
    };
  };
  // Nur aktive Einheiten wie im Meldebild (LLH-1079, `filterAktive`): der Server liefert schon
  // gefiltert; eine aufgelöste steht im Block „Aufgelöst“ unter der Tabelle, ihre Untereinheit
  // wird Wurzel.
  return einheitenBaum(filterAktive(einheiten), abschnitte).map(zeile);
}
