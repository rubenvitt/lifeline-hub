import { describe, expect, it } from 'vitest';
import type { EinsatzMaterial, Nachforderung } from '../api/types';
import { OHNE_ORT_WERT } from '../kraefte/materialPosten';
import {
  isErgaenzen,
  zuordenbarePosten,
  uebernahmeBody,
  uebernahmeVorbelegung,
  uebernommenePosten,
  uebernommeneMenge,
} from './materialUebernahme';

type N = Pick<Nachforderung, 'id' | 'art' | 'anzahl' | 'material_ids'>;
const nf = (over: Partial<N> = {}): N => ({
  id: 4,
  art: 'Sandsäcke',
  anzahl: 2000,
  material_ids: [],
  ...over,
});
type P = Pick<EinsatzMaterial, 'id' | 'menge'>;
const posten = (id: number, menge: number): P => ({ id, menge });

describe('uebernommeneMenge (LLH-1226 D5, D10)', () => {
  it('summiert die Mengen der verknüpften Posten, fremde Posten zählen nicht', () => {
    const n = nf({ material_ids: [7, 9] });
    expect(uebernommeneMenge(n, [posten(7, 1200), posten(8, 50), posten(9, 300)])).toBe(1500);
  });

  it('ohne Übernahme 0', () => {
    expect(uebernommeneMenge(nf(), [posten(7, 1200)])).toBe(0);
  });

  it('uebernommenePosten liefert die gefundenen Posten in der Folge der Kennungen', () => {
    const n = nf({ material_ids: [9, 7, 11] });
    expect(uebernommenePosten(n, [posten(7, 1), posten(9, 2)]).map((p) => p.id)).toEqual([9, 7]);
  });
});

describe('uebernahmeVorbelegung (Spec „Vorbelegte Übernahme“)', () => {
  it('Bezeichnung ist die Art, Menge die Anzahl, Art Verbrauchsgut, ohne Ort', () => {
    expect(uebernahmeVorbelegung(nf(), [])).toEqual({
      bezeichnung: 'Sandsäcke',
      menge: 2000,
      art: 'verbrauchsgut',
      ort: OHNE_ORT_WERT,
    });
  });

  it('nach einer Teillieferung der Rest: 2000 − 1200 = 800', () => {
    const n = nf({ material_ids: [7] });
    expect(uebernahmeVorbelegung(n, [posten(7, 1200)]).menge).toBe(800);
  });

  it('Rest 0 → Menge 1 und Gerät', () => {
    const n = nf({ anzahl: 3, material_ids: [7, 8, 9] });
    const v = uebernahmeVorbelegung(n, [posten(7, 1), posten(8, 1), posten(9, 1)]);
    expect(v.menge).toBe(1);
    expect(v.art).toBe('geraet');
  });

  it('mehr übernommen als nachgefordert → Menge 1', () => {
    const n = nf({ anzahl: 2, material_ids: [7] });
    expect(uebernahmeVorbelegung(n, [posten(7, 5)]).menge).toBe(1);
  });

  it('ohne Anzahl Menge 1, Art Gerät', () => {
    const v = uebernahmeVorbelegung(nf({ art: 'Tauchpumpe', anzahl: null }), []);
    expect(v).toMatchObject({ bezeichnung: 'Tauchpumpe', menge: 1, art: 'geraet' });
  });

  it('Anzahl 1 → Gerät', () => {
    expect(uebernahmeVorbelegung(nf({ anzahl: 1 }), []).art).toBe('geraet');
  });

  it('Leerraum um die Art fällt weg', () => {
    expect(uebernahmeVorbelegung(nf({ art: '  Tauchpumpe ' }), []).bezeichnung).toBe('Tauchpumpe');
  });
});

describe('isErgaenzen (D3)', () => {
  it('ergänzen erst, wenn schon ein Posten verknüpft ist', () => {
    expect(isErgaenzen(nf())).toBe(false);
    expect(isErgaenzen(nf({ material_ids: [7] }))).toBe(true);
  });
});

describe('uebernahmeBody (D1, D3)', () => {
  it('Ad-hoc mit Bezug, Ort als Feld des POST, ohne ergaenzen bei der ersten Übernahme', () => {
    expect(
      uebernahmeBody(nf(), { art: 'verbrauchsgut', menge: 1200, ort: 'einheit:3' }, false),
    ).toEqual({
      adhoc: { bezeichnung: 'Sandsäcke' },
      menge: 1200,
      optionen: {
        art: 'verbrauchsgut',
        ort: { einheit_id: 3 },
        nachforderungId: 4,
        ergaenzen: false,
      },
    });
  });

  it('ein Gerät geht mit Menge 1, auch wenn im Feld mehr stand', () => {
    expect(
      uebernahmeBody(
        nf({ art: 'Tauchpumpe' }),
        { art: 'geraet', menge: 3, ort: OHNE_ORT_WERT },
        false,
      ),
    ).toMatchObject({ menge: 1, optionen: { art: 'geraet', ort: undefined } });
  });

  it('ergänzt nur mit der Absicht des Dialogs, nicht aus dem Stand der Nachforderung', () => {
    const w = { art: 'verbrauchsgut', menge: 800, ort: OHNE_ORT_WERT } as const;
    expect(uebernahmeBody(nf({ material_ids: [7] }), w, true).optionen.ergaenzen).toBe(true);
    // Ein Live-Abgleich brachte den Posten eines anderen Platzes: ohne Absicht kein Ergänzen.
    expect(uebernahmeBody(nf({ material_ids: [7] }), w, false).optionen.ergaenzen).toBe(false);
  });
});

describe('zuordenbarePosten (LLH-1259 D5)', () => {
  type Z = Pick<EinsatzMaterial, 'id' | 'bezeichnung' | 'nachforderung_id' | 'beendet_at'>;
  const z = (id: number, bezeichnung: string, over: Partial<Z> = {}): Z => ({
    id,
    bezeichnung,
    nachforderung_id: null,
    beendet_at: null,
    ...over,
  });

  it('nur aktive Posten ohne Bezug; passende Bezeichnung zuerst, sonst alphabetisch', () => {
    const material = [
      z(1, 'Wolldecken'),
      z(2, 'Feldbetten', { nachforderung_id: 9 }),
      z(3, 'Feldbett (Spende)'),
      z(4, 'Feldbetten', { beendet_at: '2026-10-22T10:00:00Z' }),
      z(5, 'Bänke'),
      z(6, 'feldbetten THW'),
    ];
    expect(zuordenbarePosten({ art: 'Feldbett' }, material).map((p) => p.id)).toEqual([3, 6, 5, 1]);
  });

  it('ohne freien Posten leer', () => {
    expect(
      zuordenbarePosten({ art: 'Feldbett' }, [z(2, 'Feldbetten', { nachforderung_id: 9 })]),
    ).toEqual([]);
  });
});
