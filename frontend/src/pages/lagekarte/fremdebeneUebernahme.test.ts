import { describe, expect, it } from 'vitest';
import {
  UEBERNAHME_TEILE_MAX,
  uebernahmeLabel,
  uebernahmeNotiz,
  zerlege,
  zonenArtenFuer,
} from './fremdebeneUebernahme';

const ring = (x: number) => [
  [x, 50],
  [x + 0.1, 50],
  [x + 0.1, 50.1],
  [x, 50],
];
const loch = [
  [9.02, 50.02],
  [9.04, 50.02],
  [9.04, 50.04],
  [9.02, 50.02],
];

describe('zerlege (LLH-2129)', () => {
  it('ein Punkt wird ein Punkt-Teil', () => {
    expect(zerlege({ type: 'Point', coordinates: [9, 50] })).toEqual({
      teile: [{ art: 'punkt', geometrie: { type: 'Point', coordinates: [9, 50] } }],
    });
  });

  it('teilt ein MultiPolygon auf und behält Löcher', () => {
    const r = zerlege({
      type: 'MultiPolygon',
      coordinates: [[ring(9), loch], [ring(10)], [ring(11)]],
    });
    expect('teile' in r && r.teile.map((t) => t.art)).toEqual(['flaeche', 'flaeche', 'flaeche']);
    expect('teile' in r && r.teile[0].geometrie).toEqual({
      type: 'Polygon',
      coordinates: [ring(9), loch],
    });
  });

  it('teilt eine MultiLineString in Linien', () => {
    const r = zerlege({
      type: 'MultiLineString',
      coordinates: [
        [
          [9, 50],
          [9.1, 50.1],
        ],
        [
          [10, 50],
          [10.1, 50.1],
        ],
      ],
    });
    expect('teile' in r && r.teile.map((t) => t.art)).toEqual(['linie', 'linie']);
    expect('teile' in r && r.teile[1].geometrie.type).toBe('LineString');
  });

  it('teilt eine gleichartige GeometryCollection', () => {
    const r = zerlege({
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', coordinates: [ring(9)] },
        { type: 'Polygon', coordinates: [ring(10)] },
      ],
    });
    expect('teile' in r && r.teile.map((t) => t.art)).toEqual(['flaeche', 'flaeche']);
  });

  it('lehnt eine gemischte GeometryCollection ab', () => {
    expect(
      zerlege({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Polygon', coordinates: [ring(9)] },
          { type: 'Point', coordinates: [9, 50] },
        ],
      }),
    ).toEqual({ grund: 'gemischt' });
  });

  it(`lehnt mehr als ${UEBERNAHME_TEILE_MAX} Teile ab`, () => {
    const coordinates = Array.from({ length: UEBERNAHME_TEILE_MAX + 1 }, (_, i) => [
      9 + i / 100,
      50,
    ]);
    expect(zerlege({ type: 'MultiPoint', coordinates })).toEqual({ grund: 'zu_viele' });
    expect(UEBERNAHME_TEILE_MAX).toBe(20);
  });

  it('ohne Geometrie gibt es nichts zu übernehmen', () => {
    expect(zerlege(null)).toEqual({ grund: 'leer' });
    expect(zerlege(undefined)).toEqual({ grund: 'leer' });
  });
});

describe('zonenArtenFuer', () => {
  it('Fläche: vier Arten, Gefahrengebiet vorn, kein Evakuierungsbezirk', () => {
    expect(zonenArtenFuer('flaeche').map((t) => t.typ)).toEqual([
      'gefahrengebiet',
      'absperrbereich',
      'sperrgebiet',
      'freie_skizze',
    ]);
  });

  it('Linie: Absperrgrenze vorn, dann freie Skizze', () => {
    expect(zonenArtenFuer('linie').map((t) => t.typ)).toEqual(['absperrgrenze', 'freie_skizze']);
  });
});

describe('uebernahmeLabel', () => {
  it('ohne Objektnamen gilt der Ebenenname', () => {
    expect(uebernahmeLabel(null, 'Ebene', 0, 1)).toBe('Ebene');
    expect(uebernahmeLabel('  ', 'Ebene', 0, 1)).toBe('Ebene');
  });

  it('mehrere Teile tragen ihre Nummer', () => {
    expect(uebernahmeLabel('A', 'E', 1, 3)).toBe('A (2/3)');
  });

  it('kürzt auf 200 Zeichen und behält die Nummer', () => {
    const l = uebernahmeLabel('x'.repeat(250), 'E', 0, 3);
    expect(l).toHaveLength(200);
    expect(l.endsWith(' (1/3)')).toBe(true);
  });
});

describe('uebernahmeNotiz', () => {
  it('Herkunftssatz, Leerzeile, Beschreibung', () => {
    expect(uebernahmeNotiz('E', 'Text')).toBe('Übernommen aus Fremdebene «E».\n\nText');
  });

  it('ohne Beschreibung nur der Satz', () => {
    expect(uebernahmeNotiz('E', null)).toBe('Übernommen aus Fremdebene «E».');
  });

  it('bleibt in der Grenze der Notiz', () => {
    expect(uebernahmeNotiz('E', 'y'.repeat(3000)).length).toBeLessThanOrEqual(2000);
  });
});
