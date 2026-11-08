import type { Schichtplan, SchichtplanPerson } from '../../../api/types';
import { alsZeitpunkt } from '../../../anzeige/zeitEingabe';
import type { RasterZeile } from '../raster';
import {
  OHNE_ABSCHNITT,
  PAUSE,
  eingabeSchluessel,
  personEingabe,
  postenSchluessel,
} from '../schichtplanZeilen';
import type { AusgabePerson, AusgabePlan, AusgabePosten } from './ausgabePlan';

/**
 * Der Schichtplan eines Einsatzes als Ausgabeplan (LLH-1557, design D1). Posten, Abschnitt und
 * Reihenfolge kommen aus den Zeilen der Ansicht (`baueZeilen`), damit Aushang und Raster dieselbe
 * Folge haben. Helfer tragen Organisation und Telefon aus dem Plan; Stamm-Personal und Ad-hoc-Kräfte
 * nur den Namen.
 */
export function ausEinsatzPlan(plan: Schichtplan, zeilen: readonly RasterZeile[]): AusgabePlan {
  const posten: AusgabePosten[] = zeilen.map((z) => ({
    schluessel: z.schluessel,
    titel: z.titel,
    abschnitt: z.gruppe == null || z.gruppe === OHNE_ABSCHNITT ? null : z.gruppe,
    istPause: z.schluessel === PAUSE,
  }));
  const bekannt = new Set(posten.map((p) => p.schluessel));
  // Ein Block an einem Posten, den die Zeilen nicht kennen, stünde sonst auf keinem Blatt.
  for (const b of plan.bloecke) {
    const s = postenSchluessel(b.posten);
    if (bekannt.has(s)) continue;
    bekannt.add(s);
    posten.push({
      schluessel: s,
      titel: b.posten.bezeichnung ?? (b.posten.art === 'uhs' ? 'UHS' : 'Einheit'),
      abschnitt: null,
      istPause: s === PAUSE,
    });
  }

  const ohneNamen = plan.helfer == null || plan.bloecke.some((b) => b.personen == null);
  const helfer = new Map((plan.helfer ?? []).map((h) => [h.id, h]));
  const personen = new Map<string, AusgabePerson>();
  const schluesselVon = (p: SchichtplanPerson): string | null => {
    const e = personEingabe(p);
    return e ? eingabeSchluessel(e) : null;
  };

  const schichten = plan.bloecke.map((b) => {
    const eingeteilt: string[] = [];
    for (const p of b.personen ?? []) {
      const s = schluesselVon(p);
      if (s == null) continue;
      eingeteilt.push(s);
      if (personen.has(s)) continue;
      const h = p.helfer_id != null ? helfer.get(p.helfer_id) : undefined;
      personen.set(s, {
        schluessel: s,
        name: p.name,
        organisation: h?.organisation ?? null,
        telefon: h?.telefon ?? null,
        qualifikationen: p.qualifikationen,
      });
    }
    return {
      id: String(b.id),
      posten: postenSchluessel(b.posten),
      von: b.von,
      bis: b.bis,
      vonMs: alsZeitpunkt(b.von)?.valueOf() ?? 0,
      bisMs: alsZeitpunkt(b.bis)?.valueOf() ?? 0,
      sollAnzahl: b.soll_anzahl ?? null,
      qualiSoll: (b.quali_soll ?? []).map((q) => ({ label: q.label, anzahl: q.anzahl })),
      offen: b.offene_plaetze,
      personenAnzahl: b.personen_anzahl,
      personen: ohneNamen ? null : eingeteilt,
    };
  });

  return { posten, schichten, personen: ohneNamen ? null : [...personen.values()] };
}
