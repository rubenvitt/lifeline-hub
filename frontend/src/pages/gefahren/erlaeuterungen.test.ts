import { describe, expect, it } from 'vitest';
import type { GefahrBewertung } from '../../api/types';
import {
  erlaeuterungEinzeilig,
  geaendertText,
  gesetzteGefahren,
  hatErlaeuterung,
  zellTitel,
  zellenMitErlaeuterung,
} from './erlaeuterungen';

const zelle = (over: Partial<GefahrBewertung>): GefahrBewertung => ({
  id: 1,
  gefahrengebiet_id: 7,
  gefahrentyp: 'brand',
  schutzobjekt: 'menschen',
  warnstufe: 'keine',
  beschreibung: null,
  gemeldet_von: null,
  aktualisiert_von: 1,
  erstellt_at: '',
  geaendert_at: '',
  ...over,
});

describe('Erläuterungen der Gefahrenbewertung (LLH-1110)', () => {
  it('erkennt eine Erläuterung erst an sichtbarem Text', () => {
    expect(hatErlaeuterung(zelle({ beschreibung: 'Keller' }))).toBe(true);
    expect(hatErlaeuterung(zelle({ beschreibung: '   ' }))).toBe(false);
    expect(hatErlaeuterung(zelle({ beschreibung: null }))).toBe(false);
    expect(hatErlaeuterung(zelle({ beschreibung: undefined }))).toBe(false);
  });

  it('listet nur Zellen mit Erläuterung, alphabetisch nach Gefahr, dann in Spaltenfolge', () => {
    const matrix = [
      zelle({ id: 1, gefahrentyp: 'ertrinken', beschreibung: 'Strömung' }),
      zelle({
        id: 2,
        gefahrentyp: 'elektrizitaet',
        schutzobjekt: 'einsatzkraefte',
        beschreibung: 'a',
      }),
      zelle({ id: 3, gefahrentyp: 'elektrizitaet', schutzobjekt: 'menschen', beschreibung: 'b' }),
      zelle({ id: 4, gefahrentyp: 'brand', warnstufe: 'hoch' }),
      zelle({ id: 5, gefahrentyp: 'absturz', beschreibung: 'Hang', warnstufe: 'keine' }),
    ];
    expect(zellenMitErlaeuterung(matrix).map((z) => z.id)).toEqual([5, 3, 2, 1]);
  });

  it('lässt ein nicht anwendbares Paar weg, auch mit Text', () => {
    const matrix = [
      zelle({ gefahrentyp: 'ertrinken', schutzobjekt: 'sachwerte', beschreibung: 'x' }),
    ];
    expect(zellenMitErlaeuterung(matrix)).toEqual([]);
    expect(gesetzteGefahren(matrix)).toEqual([]);
  });

  it('zählt als gesetzte Gefahr eine Stufe über „keine“ oder eine Erläuterung', () => {
    const matrix = [
      zelle({ id: 1, gefahrentyp: 'brand', warnstufe: 'hoch' }),
      zelle({ id: 2, gefahrentyp: 'absturz', warnstufe: 'keine', beschreibung: 'geprüft' }),
      zelle({ id: 3, gefahrentyp: 'einsturz', warnstufe: 'keine' }),
    ];
    expect(gesetzteGefahren(matrix).map((z) => z.id)).toEqual([2, 1]);
  });

  it('benennt die Zelle mit Gefahr und Schutzobjekt', () => {
    expect(zellTitel('elektrizitaet', 'einsatzkraefte')).toBe('Elektrizität × Einsatzkräfte');
  });

  it('schreibt die Erläuterung in eine Zeile', () => {
    expect(erlaeuterungEinzeilig(zelle({ beschreibung: '  Keller\n\nunter  Wasser ' }))).toBe(
      'Keller unter Wasser',
    );
  });

  it('nennt die letzte Änderung mit Zeit und Name, ohne Namen nur die Zeit', () => {
    const fmt = (s: string) => `DTG(${s})`;
    expect(
      geaendertText(
        zelle({ geaendert_at: '2026-10-10 15:12:00', aktualisiert_von_name: 'Erika' }),
        fmt,
      ),
    ).toBe('geändert DTG(2026-10-10 15:12:00) · Erika');
    expect(geaendertText(zelle({ geaendert_at: '2026-10-10 15:12:00' }), fmt)).toBe(
      'geändert DTG(2026-10-10 15:12:00)',
    );
  });
});
