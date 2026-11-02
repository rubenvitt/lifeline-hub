import type { RichtwertEbenen, UnterkunftRichtwerte } from '../api/types';
import { RICHTWERTE_BASIS, RICHTWERTE_STAND } from '../betreuung/unterkunft/richtwerte';

/**
 * Antwort der Richtwerte-Routen (LLH-1520) aus der Basis-Datei, mit Werten je Ebene. Rechnet den
 * wirksamen Wert wie der Server: Einsatz vor Organisation vor Basis.
 */
export function richtwerteAntwort(
  org: Record<string, number> = {},
  einsatz: Record<string, number> = {},
): UnterkunftRichtwerte {
  return {
    stand: RICHTWERTE_STAND,
    werte: RICHTWERTE_BASIS.map((b): RichtwertEbenen => {
      const o = org[b.schluessel] ?? null;
      const e = einsatz[b.schluessel] ?? null;
      return {
        schluessel: b.schluessel,
        basis: b.wert,
        org: o,
        einsatz: e,
        wert: e ?? o ?? b.wert,
        herkunft: e != null ? 'einsatz' : o != null ? 'org' : 'basis',
      };
    }),
  };
}
