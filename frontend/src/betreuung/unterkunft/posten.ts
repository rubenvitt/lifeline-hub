/**
 * Posten für „Nachforderungen anlegen“ aus einem Ergebnis des Rechners (LLH-1520, design.md D6).
 *
 * Je Posten entsteht eine eigene Nachforderung mit Bezug zur Stelle (bestehender Schreibweg,
 * `nachforderung-betreuungsstelle`). Vorausgewählt ist, was eine Notunterkunft fast immer braucht;
 * der Rest steht zur Wahl. Posten mit Anzahl 0 fallen weg.
 */
import type { Ergebnis } from './rechnerKern';
import { ZELTTYPEN } from './richtwerte';

export interface Posten {
  /** Stabiler Schlüssel für Formular und Tests. */
  schluessel: string;
  /** Art der Nachforderung, wie auf der Nachforderungsseite. */
  art: string;
  anzahl: number;
  /** Details zur Art, z. B. „Liter je Tag“. */
  bezeichnung?: string;
  vorgewaehlt: boolean;
}

const ZELT_NAME = new Map(ZELTTYPEN.map((t) => [t.typ, t.bezeichnung]));

export function postenAus(ergebnis: Ergebnis): Posten[] {
  const liste: Posten[] = [
    {
      schluessel: 'feldbetten',
      art: 'Feldbetten',
      anzahl: ergebnis.material.feldbetten,
      vorgewaehlt: true,
    },
    { schluessel: 'decken', art: 'Decken', anzahl: ergebnis.material.decken, vorgewaehlt: true },
    {
      schluessel: 'toiletten',
      art: 'Mobile Toiletten',
      anzahl: ergebnis.sanitaer.toiletten,
      vorgewaehlt: true,
    },
    {
      schluessel: 'urinale',
      art: 'Urinale',
      anzahl: ergebnis.sanitaer.urinale,
      vorgewaehlt: false,
    },
    {
      schluessel: 'waschplaetze',
      art: 'Waschplätze',
      anzahl: ergebnis.sanitaer.waschplaetze,
      vorgewaehlt: true,
    },
    {
      schluessel: 'duschen',
      art: 'Duschen',
      anzahl: ergebnis.sanitaer.duschen,
      vorgewaehlt: false,
    },
    {
      schluessel: 'garnituren',
      art: 'Biergarnituren',
      anzahl: ergebnis.verpflegung.garnituren,
      vorgewaehlt: false,
    },
    {
      schluessel: 'wasser',
      art: 'Wasser',
      anzahl: ergebnis.versorgung.wasser_l_tag,
      bezeichnung: 'Liter je Tag',
      vorgewaehlt: false,
    },
  ];
  // Beim Weg Zelte stehen die Zelte schon; sonst ist der Zeltmix ein möglicher Bedarf.
  if (ergebnis.weg !== 'zelte') {
    for (const z of ergebnis.schlafen.zeltmix) {
      liste.push({
        schluessel: `zelt_${z.typ}`,
        art: `Zelt ${ZELT_NAME.get(z.typ) ?? z.typ}`,
        anzahl: z.anzahl,
        bezeichnung: 'Schlafzelt',
        vorgewaehlt: false,
      });
    }
  }
  return liste.filter((p) => p.anzahl > 0);
}
