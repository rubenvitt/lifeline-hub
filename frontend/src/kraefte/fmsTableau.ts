import type { EinsatzFahrzeug, Einheit, FahrzeugStatus } from '../api/types';
import type { StatusOption } from '../components/StatusWahl';
import { statusKategorie } from '../theme/statusFarben';
import { fmsWort } from './meldebildRaster';

/**
 * Reines Modell des FMS-Tableaus (LFH-642) — Gliederung, Menüwerte, Ziffernzuordnung.
 *
 * ── FORMVERDIKT ────────────────────────────────────────────────────────────────────────
 *
 * Kachel, nicht Tabelle (LFH-19/LFH-330, entschieden am 23.09.2026). Die Frage an diese
 * Fläche ist weder „welcher von diesen ist der richtige?" (Vergleich → Tabelle) noch „was
 * ist mit diesem hier?" (Liste), sondern „wie steht die ganze Flotte?" — eine
 * Überblicksfläche, und für die sieht LFH-330 die Kachel vor. Die Tabelle gibt es daneben
 * weiter, als Ansicht „Liste" derselben Seite; beide lesen dieselbe Query und bedienen
 * dieselbe Mutation.
 *
 * ── REIHENFOLGE IST STABIL ─────────────────────────────────────────────────────────────
 *
 * Abschnitt → Einheit → Funkrufname, NIE nach Status. Ein Tableau wird bedient, während es
 * sich ändert: sortierte es nach Status, spränge die Kachel beim eigenen Klick unter dem
 * Finger weg (Kriterium 12). Der Abschnitt kommt über die Einheit — ein Fahrzeug hat keinen
 * eigenen Abschnittsbezug (`src/fahrzeug/mod.rs`, `EinsatzFahrzeugAnzeige`).
 */

export const OHNE_ABSCHNITT_TITEL = 'ohne Abschnitt';
export const OHNE_EINHEIT_TITEL = 'ohne Einheit';
/** Titel der einen Gruppe, wenn die Einheiten nicht abrufbar sind (Modul `einheiten` gesperrt). */
export const UNGEGLIEDERT_TITEL = 'Alle Fahrzeuge';

export interface FmsKachel {
  ef: EinsatzFahrzeug;
  /** Name der Einheit, `null` ohne (bekannte) Einheit. */
  einheit: string | null;
}

export interface FmsGruppe {
  schluessel: string;
  titel: string;
  kacheln: FmsKachel[];
}

const vergleiche = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });

function nachEinheitUndFunkruf(a: FmsKachel, b: FmsKachel): number {
  return vergleiche(a.einheit ?? '', b.einheit ?? '') || vergleiche(a.ef.funkrufname, b.ef.funkrufname);
}

/**
 * Gruppen des Tableaus. `einheiten === null` heißt „nicht abrufbar" — dann steht alles in
 * EINER Gruppe, statt dass die Fläche ausfällt: der Status lässt sich auch ohne Gliederung
 * setzen. Eine Einheit-ID, die in der Liste fehlt, zählt als „ohne Einheit": das Fahrzeug
 * verschwindet nicht, nur weil seine Einheit gerade nicht mitgeliefert wurde.
 */
export function baueFmsTableau(
  fahrzeuge: readonly EinsatzFahrzeug[],
  einheiten: readonly Einheit[] | null,
): FmsGruppe[] {
  if (fahrzeuge.length === 0) return [];
  if (einheiten === null) {
    const kacheln = fahrzeuge
      .map((ef) => ({ ef, einheit: null }))
      .sort((a, b) => vergleiche(a.ef.funkrufname, b.ef.funkrufname));
    return [{ schluessel: 'alle', titel: UNGEGLIEDERT_TITEL, kacheln }];
  }

  const einheitNach = new Map(einheiten.map((e) => [e.id, e]));
  const abschnitte = new Map<number, FmsGruppe>();
  const ohneAbschnitt: FmsGruppe = {
    schluessel: 'ab-ohne',
    titel: OHNE_ABSCHNITT_TITEL,
    kacheln: [],
  };
  const ohneEinheit: FmsGruppe = { schluessel: 'eh-ohne', titel: OHNE_EINHEIT_TITEL, kacheln: [] };

  for (const ef of fahrzeuge) {
    const e = ef.einheit_id != null ? einheitNach.get(ef.einheit_id) : undefined;
    if (!e) {
      ohneEinheit.kacheln.push({ ef, einheit: null });
      continue;
    }
    const kachel = { ef, einheit: e.name };
    if (e.abschnitt_id == null) {
      ohneAbschnitt.kacheln.push(kachel);
      continue;
    }
    let gruppe = abschnitte.get(e.abschnitt_id);
    if (!gruppe) {
      gruppe = {
        schluessel: `ab-${e.abschnitt_id}`,
        titel: e.abschnitt_name ?? `Abschnitt ${e.abschnitt_id}`,
        kacheln: [],
      };
      abschnitte.set(e.abschnitt_id, gruppe);
    }
    gruppe.kacheln.push(kachel);
  }

  return [
    ...[...abschnitte.values()].sort((a, b) => vergleiche(a.titel, b.titel)),
    ohneAbschnitt,
    ohneEinheit,
  ]
    .filter((g) => g.kacheln.length > 0)
    .map((g) => ({ ...g, kacheln: [...g.kacheln].sort(nachEinheitUndFunkruf) }));
}

/**
 * Der Fahrzeugkatalog als Menüwerte, beschriftet wie der Chip („S4 · Am Einsatzort").
 * Der S-Code im Menü ist zugleich der Hinweis auf das Tastenkürzel. Ton aus der Kategorie,
 * Mandantenfarbe nur als Punkt (`StatusWahl`).
 */
export function fmsStatusOptionen(katalog: readonly FahrzeugStatus[]): StatusOption<number>[] {
  return katalog.map((s) => ({
    wert: s.id,
    label: s.fms_anker != null ? `S${s.fms_anker} · ${fmsWort(s.label, s.fms_anker)}` : s.label,
    darstellung: statusKategorie[s.kategorie],
    farbe: s.farbe,
  }));
}

/** Was eine Ziffer auslöst. Eine Ziffer ohne Eintrag ist keinem Status zugeordnet. */
export type ZifferZiel =
  { art: 'eindeutig'; status: FahrzeugStatus } | { art: 'mehrdeutig'; anzahl: number };

/**
 * Ziffer → Status aus `fms_anker`. Der Anker ist NULLABLE und NICHT eindeutig
 * (`migrations/0008_fahrzeug_status.sql`: nur `UNIQUE(org_id, label)`), deshalb ist die
 * Ziffer nur ein Beschleuniger (Bedien-Leitlinie, C4): eine doppelt belegte Ziffer setzt
 * NICHTS — raten, welcher der beiden gemeint war, hieße einen Status erfinden.
 */
export function zifferZuordnung(
  katalog: readonly FahrzeugStatus[],
): ReadonlyMap<number, ZifferZiel> {
  const zuordnung = new Map<number, ZifferZiel>();
  for (const s of katalog) {
    if (s.fms_anker == null) continue;
    const bisher = zuordnung.get(s.fms_anker);
    zuordnung.set(
      s.fms_anker,
      bisher == null
        ? { art: 'eindeutig', status: s }
        : { art: 'mehrdeutig', anzahl: bisher.art === 'mehrdeutig' ? bisher.anzahl + 1 : 2 },
    );
  }
  return zuordnung;
}
