/**
 * Der Zahlenkern der Anzeige (LLH-1146): Dezimalzahlen deutsch, mit Komma und Tausenderpunkt,
 * Minus als echtes „−“ (U+2212) wie `wetter/wetterText.ts`. „1.200“ liest eine Einsatzkraft als
 * Tausend; eine Entfernung, ein Pegel oder eine Größe mit Dezimalpunkt ist deshalb eine echte
 * Verwechslungsgefahr. Anzeige-Code formatiert Dezimalzahlen nur hierüber, nie mit `toFixed`
 * (Wächter `anzeige/zahl.guard.test.ts`). Koordinaten und Wire-/URL-Werte bleiben mit Punkt
 * (`anzeige/koordinaten.ts`, `routing/deeplinks.ts`).
 *
 * Rein; der Formatter je Stellenzahl wird einmal gebaut (keine Zone, nichts friert ein).
 */

const MINUS = '−';

export interface ZahlOptionen {
  /** Nachkommastellen, fest (Vorgabe 0): `1,20 km` bleibt `1,20`, nicht `1,2`. */
  stellen?: number;
  /** Tausenderpunkt (Vorgabe ja): `12.345,6`. */
  gruppierung?: boolean;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(stellen: number, gruppierung: boolean): Intl.NumberFormat {
  const key = `${stellen}|${gruppierung}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: stellen,
      maximumFractionDigits: stellen,
      useGrouping: gruppierung,
    });
    formatters.set(key, fmt);
  }
  return fmt;
}

/** `zahlText(1.2, { stellen: 2 })` → „1,20“, `zahlText(-3.5, { stellen: 1 })` → „−3,5“. */
export function zahlText(wert: number, { stellen = 0, gruppierung = true }: ZahlOptionen = {}) {
  return formatterFor(stellen, gruppierung).format(wert).replace(/^-/, MINUS);
}
