import type { EinsatzFahrzeug, EinsatzMaterial, EinsatzPersonal } from '../api/types';
import { funktionText } from './einsatzfunktionKern';

/**
 * Eine beendete Kraft im Nachweis des Meldebilds (LLH-1079, Spec `kraefte-entlassung`,
 * „Entlassene im Nachweis“): Kennung, Zusatz und Zeitpunkt des Endes. Die Einheit, aus der sie
 * ging, steht nur im ETB-Text (design.md, offene Frage 3); die Zeile kennt sie nach dem Entlassen
 * nicht mehr.
 */
export interface BeendeteKraft {
  name: string;
  /** Person: Einsatzfunktion, sonst Qualifikation (LLH-1067); Fahrzeug: Typ. */
  zusatz?: string | null;
  /** Zeitpunkt des Endes (Server, UTC). */
  beendetAt?: string | null;
}

/**
 * Der Nachweis unter dem Meldebild (LLH-1235): entlassene Personen und Fahrzeuge, aus dem Einsatz
 * genommenes Material. `null` heißt „nicht geladen“, damit ein gescheiterter Abruf nicht wie
 * „niemand entlassen“ aussieht.
 */
export interface MeldebildNachweis {
  personal: readonly BeendeteKraft[] | null;
  fahrzeuge: readonly BeendeteKraft[] | null;
  material: readonly BeendeteKraft[] | null;
  /** ISO-Zeitpunkt → taktische DTG, dieselbe Schreibweise wie der Stand. */
  dtg: (iso: string) => string;
}

// Stornierte erscheinen in keinem Nachweis, auch wenn sie in eine Liste geraten.
const entlassen = (x: { beendet_als?: string | null }) => x.beendet_als === 'entlassen';

/** Die entlassenen Kräfte einer Liste. */
export function toEntlassene(personal: readonly EinsatzPersonal[]): BeendeteKraft[] {
  return personal
    .filter(entlassen)
    .map((ep) => ({ name: ep.name, zusatz: funktionText(ep), beendetAt: ep.beendet_at }));
}

/** Die entlassenen Fahrzeuge einer Liste. */
export function toEntlasseneFahrzeuge(fahrzeuge: readonly EinsatzFahrzeug[]): BeendeteKraft[] {
  return fahrzeuge
    .filter(entlassen)
    .map((ef) => ({ name: ef.funkrufname, zusatz: ef.fahrzeugtyp, beendetAt: ef.beendet_at }));
}

/**
 * Das aus dem Einsatz genommene Material einer Liste (auf dem Draht `entlassen`). Die Menge steht
 * wie in der Kräftegliederung hinter der Bezeichnung („Trage ×2“).
 */
export function toHerausgenommenesMaterial(material: readonly EinsatzMaterial[]): BeendeteKraft[] {
  return material
    .filter(entlassen)
    .map((em) => ({ name: `${em.bezeichnung} ×${em.menge}`, beendetAt: em.beendet_at }));
}
