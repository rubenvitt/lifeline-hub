import {
  adminAufbewahrung,
  adminBenutzer,
  adminDemoDaten,
  adminGruppen,
  adminZugangsprotokoll,
} from '../admin/adminNav';

/**
 * Wo eine Person auf Ebene 1 steht (LFH-954, Spec `seiten-orientierung`) — rein und exportiert.
 *
 * - `titel`: die Teile des Tab-Titels vom engsten zum weitesten Ort („Fahrzeuge · Verwaltung“).
 * - `ort`: der Ortspfad hinter „Einsätze ›“ auf Profil und Verwaltung, sonst `null` (die
 *   Einsatzliste ist selbst der Anfang). Profil und Verwaltung tragen dort den Rückweg in den Einsatz.
 *
 * Die Sektionsnamen kommen aus der Admin-Registry, derselben Quelle wie die Seitenleiste.
 */
export interface Ebene1Ort {
  titel: string[];
  ort: string[] | null;
}

const VERWALTUNG = 'Verwaltung';
const SONDEREINTRAEGE = [adminBenutzer, adminDemoDaten, adminAufbewahrung, adminZugangsprotokoll];

function verwaltungsSektion(teile: string[]): string | null {
  const [gruppe, sektion] = teile;
  const g = adminGruppen.find((x) => x.key === gruppe);
  if (g) return g.sektionen.find((s) => s.key === sektion)?.label ?? null;
  return SONDEREINTRAEGE.find((e) => e.key === gruppe)?.label ?? null;
}

export function ebene1Seite(pathname: string): Ebene1Ort {
  const teile = pathname.split('/').filter(Boolean);
  if (teile[0] === 'einsaetze' && teile.length === 1) return { titel: ['Einsätze'], ort: null };
  if (teile[0] === 'profil') return { titel: ['Profil'], ort: ['Profil'] };
  if (teile[0] === 'admin') {
    const sektion = verwaltungsSektion(teile.slice(1));
    return sektion
      ? { titel: [sektion, VERWALTUNG], ort: [VERWALTUNG, sektion] }
      : { titel: [VERWALTUNG], ort: [VERWALTUNG] };
  }
  return { titel: [], ort: null };
}
