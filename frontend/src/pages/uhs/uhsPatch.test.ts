import { describe, expect, it } from 'vitest';
import type { Uhs } from '../../api/types';
import { uhsAngabenWerte, uhsPatch } from './uhsPatch';

/**
 * Teil-Patch der UHS-Stammdaten (LLH-1407, LLH-1920): verglichen werden die Werte beim Öffnen mit
 * den Eingaben. Der Standort ist ein Ortsfeld, Text und Koordinate gehen nur geändert hinaus, ein
 * geleerter Standort leert beide; Soll-Anzahl und Qualifikationssoll leer heißt keins (LLH-1553).
 */
const basis = {
  id: 9,
  einsatz_id: 1,
  bezeichnung: 'BHP 50',
  typ: 'behandlungsplatz',
  status: 'aktiv',
  standort: 'Halle 1',
  notiz: null,
  lat: 53.0775,
  lon: 8.81,
  soll_anzahl: null,
  quali_soll: [],
} as unknown as Uhs;
const vorher = uhsAngabenWerte(basis);
const punkt = { lat: 53.0775, lon: 8.81 };

describe('uhsAngabenWerte', () => {
  it('belegt alle Felder, Leeres als leere Eingabe', () => {
    expect(vorher).toMatchObject({
      bezeichnung: 'BHP 50',
      standort: { text: 'Halle 1', koordinate: punkt },
      soll_anzahl: null,
      quali_soll: [],
      notiz: '',
    });
  });
});

describe('uhsPatch · Teil-Patch gegen die Werte beim Öffnen', () => {
  it('Textkorrektur am verorteten Standort: nur der Text geht hinaus', () => {
    expect(
      uhsPatch(vorher, {
        ...vorher,
        standort: { text: 'Halle 2', koordinate: punkt, quelle: 'karte' },
      }),
    ).toEqual({ standort: 'Halle 2' });
  });

  it('ein neuer Punkt geht als Paar hinaus, der Text bleibt draußen', () => {
    expect(
      uhsPatch(vorher, {
        ...vorher,
        standort: { text: 'Halle 1', koordinate: { lat: 53.1, lon: 8.82 }, quelle: 'karte' },
      }),
    ).toEqual({ lat: 53.1, lon: 8.82 });
  });

  it('geleerter Standort leert Text und Koordinate', () => {
    expect(uhsPatch(vorher, { ...vorher, standort: { text: ' ', koordinate: punkt } })).toEqual({
      standort: null,
      lat: null,
      lon: null,
    });
  });

  it('unverändert: leerer Patch, auch mit Leerraum', () => {
    expect(uhsPatch(vorher, { ...vorher, bezeichnung: ' BHP 50 ', notiz: '  ' })).toEqual({});
  });

  it('Notiz geleert heißt null', () => {
    const mitNotiz = uhsAngabenWerte({ ...basis, notiz: 'Tor B' } as Uhs);
    expect(uhsPatch(mitNotiz, { ...mitNotiz, notiz: '' })).toEqual({ notiz: null });
  });

  it('Soll-Anzahl und Qualifikationssoll gehen nur geändert hinaus, leer heißt keins (LLH-1553)', () => {
    const mitSoll = uhsAngabenWerte({
      ...basis,
      soll_anzahl: 4,
      quali_soll: [{ qualifikation_id: 2, label: 'Rettungssanitäter', anzahl: 1 }],
    } as Uhs);
    // Eine angefangene Zeile ohne Qualifikation zählt nicht.
    expect(
      uhsPatch(mitSoll, {
        ...mitSoll,
        quali_soll: [{ qualifikation_id: 2, anzahl: 1 }, { anzahl: 1 }],
      }),
    ).toEqual({});
    expect(uhsPatch(mitSoll, { ...mitSoll, soll_anzahl: null, quali_soll: [] })).toEqual({
      soll_anzahl: null,
      quali_soll: null,
    });
    expect(
      uhsPatch(vorher, {
        ...vorher,
        soll_anzahl: 6,
        quali_soll: [{ qualifikation_id: 1, anzahl: 2 }],
      }),
    ).toEqual({ soll_anzahl: 6, quali_soll: [{ qualifikation_id: 1, anzahl: 2 }] });
  });
});
