import { describe, expect, it } from 'vitest';
import type { Dokument } from '../api/types';
import { bezugAusWert, bezugOptionen, bezugWert } from './bezug';

const dokument = (teil: Partial<Dokument> = {}): Dokument => ({
  id: 7,
  einsatz_id: 1,
  kategorie: 'befehl',
  titel: 'Befehl 1',
  dateiname: 'befehl.pdf',
  mime: 'application/pdf',
  groesse: 10,
  etb_eintrag_id: 2,
  abgelegt_von_id: 1,
  abgelegt_at: '2026-10-01T10:00:00Z',
  ...teil,
});

const quellen = {
  abschnitte: [{ id: 3, name: 'EA Nord' }],
  einheiten: [{ id: 4, name: 'Florian 1' }],
  etb: [{ id: 9, lfd_nr: 12, inhalt: 'Lage erkundet' }],
};

describe('bezugWert / bezugAusWert', () => {
  it('bildet jeden Bezugstyp hin und zurück ab', () => {
    const faelle = [
      [dokument({ bezug_abschnitt_id: 3 }), 'abschnitt:3', { typ: 'abschnitt', id: 3 }],
      [dokument({ bezug_einheit_id: 4 }), 'einheit:4', { typ: 'einheit', id: 4 }],
      [dokument({ bezug_etb_eintrag_id: 9 }), 'etb_eintrag:9', { typ: 'etb_eintrag', id: 9 }],
    ] as const;
    for (const [d, wert, bezug] of faelle) {
      expect(bezugWert(d)).toBe(wert);
      expect(bezugAusWert(wert)).toEqual(bezug);
    }
  });

  it('liefert für ein Dokument ohne Bezug keinen Wert', () => {
    expect(bezugWert(dokument())).toBeUndefined();
    expect(bezugAusWert(undefined)).toBeUndefined();
  });

  it('lässt einen unbekannten Präfix oder eine kaputte id fallen, statt einen halben Bezug zu senden', () => {
    expect(bezugAusWert('fahrzeug:3')).toBeUndefined();
    expect(bezugAusWert('abschnitt:x')).toBeUndefined();
    expect(bezugAusWert('abschnitt:0')).toBeUndefined();
  });
});

describe('bezugOptionen', () => {
  it('gruppiert Abschnitte, Einheiten und ETB-Einträge', () => {
    const gruppen = bezugOptionen(quellen);
    expect(gruppen.map((g) => g.label)).toEqual(['Abschnitte', 'Einheiten', 'ETB-Einträge']);
    expect(gruppen[2].options).toEqual([
      { value: 'etb_eintrag:9', label: 'ETB 12 · Lage erkundet' },
    ]);
  });

  it('ergänzt einen ETB-Bezug außerhalb der geladenen Einträge aus dem Dokument', () => {
    const gruppen = bezugOptionen({
      ...quellen,
      aktuell: dokument({ bezug_etb_eintrag_id: 55, bezug_etb_lfd_nr: 3 }),
    });
    expect(gruppen[2].options).toContainEqual({ value: 'etb_eintrag:55', label: 'ETB 3' });
  });

  it('ergänzt einen Abschnitt, solange die Liste noch nicht geladen ist', () => {
    const gruppen = bezugOptionen({
      abschnitte: [],
      einheiten: [],
      etb: [],
      aktuell: dokument({ bezug_abschnitt_id: 3, bezug_abschnitt_name: 'EA Nord' }),
    });
    expect(gruppen[0].options).toEqual([{ value: 'abschnitt:3', label: 'EA Nord' }]);
  });

  it('doppelt einen schon geladenen Bezug nicht', () => {
    const gruppen = bezugOptionen({
      ...quellen,
      aktuell: dokument({ bezug_einheit_id: 4, bezug_einheit_name: 'Florian 1' }),
    });
    expect(gruppen[1].options).toHaveLength(1);
  });
});
