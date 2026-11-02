/**
 * Basis-Richtwerte des Unterkunfts- und Zeltrechners (LLH-1520, design.md D1/D2).
 *
 * Die Basis steht genau einmal in `src/unterkunft/richtwerte_basis.json`; der Server liest dieselbe
 * Datei (Schlüssel und Grenzen der Overrides). Org- und Einsatz-Werte kommen vom Server, der Rechner
 * nimmt nur die flache Karte Schlüssel → Wert.
 */
import basisDatei from '../../../../src/unterkunft/richtwerte_basis.json';

export type RichtwertGruppe =
  'schlafen' | 'sanitaer' | 'gesundheit' | 'versorgung' | 'verpflegung' | 'zelte';

export type RichtwertHerkunft = 'belegt' | 'annahme';

export interface RichtwertBasis {
  schluessel: string;
  gruppe: RichtwertGruppe;
  bezeichnung: string;
  wert: number;
  einheit: string;
  min: number;
  max: number;
  ganzzahl: boolean;
  herkunft: RichtwertHerkunft;
  quelle: string;
}

export type ZeltTyp = 'sg20' | 'sg30' | 'sg40' | 'sg50';

export const RICHTWERTE_STAND: string = basisDatei.stand;

export const RICHTWERTE_BASIS: readonly RichtwertBasis[] = basisDatei.werte as RichtwertBasis[];

export const ZELTTYPEN: readonly { typ: ZeltTyp; bezeichnung: string }[] = basisDatei.zelttypen as {
  typ: ZeltTyp;
  bezeichnung: string;
}[];

/** Flache Karte der wirksamen Werte, Schlüssel → Zahl. */
export type Richtwerte = Record<string, number>;

/** Die Basis als flache Karte. */
export function basisRichtwerte(): Richtwerte {
  return Object.fromEntries(RICHTWERTE_BASIS.map((r) => [r.schluessel, r.wert]));
}

const NACH_SCHLUESSEL = new Map(RICHTWERTE_BASIS.map((r) => [r.schluessel, r]));

export function richtwertBasis(schluessel: string): RichtwertBasis | undefined {
  return NACH_SCHLUESSEL.get(schluessel);
}

/**
 * Basis mit Overrides zusammengeführt (Ebene über Ebene). Unbekannte Schlüssel und `null` fallen
 * weg, sie erben.
 */
export function mitOverrides(
  ...ebenen: (Readonly<Record<string, number | null | undefined>> | undefined)[]
): Richtwerte {
  const wirksam = basisRichtwerte();
  for (const ebene of ebenen) {
    if (!ebene) continue;
    for (const [k, v] of Object.entries(ebene)) {
      if (NACH_SCHLUESSEL.has(k) && typeof v === 'number' && Number.isFinite(v)) wirksam[k] = v;
    }
  }
  return wirksam;
}
