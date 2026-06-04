import type { Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';

export interface Katalogeintrag<T extends string> {
  wert: T;
  label: string;
}

/** 13 Gefahrentypen (Zeilen der Matrix). Reihenfolge = Backend-Katalog. */
export const GEFAHRENTYPEN: Katalogeintrag<Gefahrentyp>[] = [
  { wert: 'atemgifte', label: 'Atemgifte' },
  { wert: 'angstreaktion', label: 'Angstreaktion' },
  { wert: 'ausbreitung', label: 'Ausbreitung' },
  { wert: 'atomare_strahlung', label: 'Atomare Strahlung' },
  { wert: 'chemische_stoffe', label: 'Chemische Stoffe' },
  { wert: 'erkrankung_verletzung', label: 'Erkrankung/Verletzung' },
  { wert: 'explosion', label: 'Explosion' },
  { wert: 'elektrizitaet', label: 'Elektrizität' },
  { wert: 'einsturz', label: 'Einsturz' },
  { wert: 'absturz', label: 'Absturz' },
  { wert: 'brand', label: 'Brand' },
  { wert: 'durchbruch', label: 'Durchbruch' },
  { wert: 'ertrinken', label: 'Ertrinken' },
];

/** 5 Schutzobjekte (Spalten der Matrix). */
export const SCHUTZOBJEKTE: Katalogeintrag<Schutzobjekt>[] = [
  { wert: 'menschen', label: 'Menschen' },
  { wert: 'tiere', label: 'Tiere' },
  { wert: 'umwelt', label: 'Umwelt' },
  { wert: 'sachwerte', label: 'Sachwerte' },
  { wert: 'einsatzkraefte', label: 'Einsatzkräfte' },
];

/** 5 Warnstufen (Dropdown je Zelle). */
export const WARNSTUFEN: Katalogeintrag<Warnstufe>[] = [
  { wert: 'keine', label: 'Keine' },
  { wert: 'niedrig', label: 'Niedrig' },
  { wert: 'mittel', label: 'Mittel' },
  { wert: 'hoch', label: 'Hoch' },
  { wert: 'akut', label: 'Akut' },
];

/** Ungültige Paare (verbatim aus bluelight-hub) → Zelle ausgegraut/nicht editierbar. */
export function kombinationGueltig(typ: Gefahrentyp, objekt: Schutzobjekt): boolean {
  if (objekt === 'sachwerte') {
    return !['angstreaktion', 'atemgifte', 'erkrankung_verletzung', 'ertrinken'].includes(typ);
  }
  if (objekt === 'umwelt') {
    return !['angstreaktion', 'erkrankung_verletzung', 'ertrinken'].includes(typ);
  }
  return true;
}

/** Hintergrundfarbe je Warnstufe (Zell-Codierung). `keine` = neutral. */
export function warnstufeFarbe(w: Warnstufe): string {
  switch (w) {
    case 'niedrig': return '#fff7e6';
    case 'mittel': return '#ffd591';
    case 'hoch': return '#ffa39e';
    case 'akut': return '#ff4d4f';
    case 'keine':
    default: return 'transparent';
  }
}
