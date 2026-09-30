import type { FuehrungsfunktionEintrag, Sachgebiet } from '../api/types';
import type { FunktionsVorschlaege } from '../fuehrung/funktionsOptionenKern';

/**
 * Fester Funktionskatalog für Komponententests (LFH-549): S2 mit Müller besetzt, S3 frei,
 * dazu Fachberater mit Pflicht-Bezeichnung. Tests ersetzen `useFunktionsVorschlaege` per
 * `vi.mock` durch {@link vorschlaegeFuer}.
 */
const KATALOG: FuehrungsfunktionEintrag[] = [
  {
    funktion: 'el',
    kuerzel: 'EL',
    label: 'Einsatzleitung',
    standard_label: 'Einsatzleitung',
    art: 'leitung',
    bezeichnung_pflicht: false,
  },
  {
    funktion: 's2',
    kuerzel: 'S2',
    label: 'Lage',
    standard_label: 'Lage',
    art: 'sachgebiet',
    bezeichnung_pflicht: false,
  },
  {
    funktion: 's3',
    kuerzel: 'S3',
    label: 'Einsatz',
    standard_label: 'Einsatz',
    art: 'sachgebiet',
    bezeichnung_pflicht: false,
  },
  {
    funktion: 'fachberater',
    label: 'Fachberater',
    standard_label: 'Fachberater',
    art: 'fachberater',
    bezeichnung_pflicht: true,
  },
];

export const TEST_VORSCHLAEGE: FunktionsVorschlaege = {
  katalog: KATALOG,
  besetzung: new Map<Sachgebiet, string>([['s2', 'Müller']]),
};

/** Wie der Produktiv-Hook: ohne Einsatz kein Katalog. */
export function vorschlaegeFuer(einsatzId: number | undefined): FunktionsVorschlaege {
  return einsatzId == null ? { katalog: [], besetzung: new Map() } : TEST_VORSCHLAEGE;
}
