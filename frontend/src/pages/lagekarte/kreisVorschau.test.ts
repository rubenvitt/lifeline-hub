import { describe, expect, it } from 'vitest';
import { abstandM } from './geo';
import {
  entferneKreisVorschau,
  griffLage,
  KREIS_VORSCHAU_EBENEN,
  kreisVorschauDaten,
  MESS_KREIS_EBENEN,
  mittenGriffSteht,
  radiusAusGriff,
  sorgeFuerKreisVorschau,
} from './kreisVorschau';
import { ZEICHNUNG_PRAEFIX } from './eigenpositionLayer';
import { KREIS_RADIUS_M_MAX } from '../../api/eingabegrenzen';
import { stilKarteAttrappe } from '../../test/stilKarteAttrappe';

const MITTE = { lat: 54, lon: 9.5 };

describe('kreisVorschauDaten (LLH-1043)', () => {
  it('ohne Mitte nichts, mit Mitte der Punkt, mit Radius auch der Kreis', () => {
    expect(kreisVorschauDaten(null).features).toEqual([]);
    expect(kreisVorschauDaten({ mitte: null, radiusM: 300 }).features).toEqual([]);
    const nurMitte = kreisVorschauDaten({ mitte: MITTE, radiusM: null }).features;
    expect(nurMitte.map((f) => f.properties.teil)).toEqual(['mitte']);
    const kreis = kreisVorschauDaten({ mitte: MITTE, radiusM: 300 }).features;
    expect(kreis.map((f) => f.properties.teil)).toEqual(['kreis', 'mitte']);
    expect(kreis[0].geometry.type).toBe('Polygon');
  });
});

describe('Radius-Griff (D6)', () => {
  it('sitzt ohne Radius auf der Mitte, mit Radius im Osten auf dem Rand', () => {
    expect(griffLage(MITTE, null)).toEqual(MITTE);
    const p = griffLage(MITTE, 300);
    expect(abstandM(MITTE, p)).toBeCloseTo(300, 3);
    expect(p.lon).toBeGreaterThan(MITTE.lon);
  });

  it('der gezogene Radius ist der Abstand zur Mitte, ganzzahlig und begrenzt', () => {
    expect(radiusAusGriff(MITTE, griffLage(MITTE, 300))).toBe(300);
    expect(radiusAusGriff(MITTE, MITTE)).toBe(1);
    expect(radiusAusGriff(MITTE, { lat: 56, lon: 9.5 })).toBe(KREIS_RADIUS_M_MAX);
  });
});

describe('Mittengriff (LLH-1344, D3)', () => {
  it('steht nur mit Mitte und Radius — ohne Radius sitzt dort der Randgriff', () => {
    expect(mittenGriffSteht(null, 300)).toBe(false);
    expect(mittenGriffSteht(MITTE, null)).toBe(false);
    expect(mittenGriffSteht(MITTE, 0)).toBe(false);
    expect(mittenGriffSteht(MITTE, 300)).toBe(true);
  });
});

describe('Vorschau-Ebenen (LLH-1043, LLH-1345)', () => {
  const kreis = { mitte: MITTE, radiusM: 300, farbe: '#123456' };

  it('der Zonen-Kreis legt ohne Angabe seine Ebenen td-zone-kreis-* samt Mitte an', () => {
    const k = stilKarteAttrappe();
    sorgeFuerKreisVorschau(k.map, kreis);
    expect(k.ids()).toEqual([
      'td-zone-kreis-flaeche',
      'td-zone-kreis-linie',
      'td-zone-kreis-mitte',
    ]);
    expect([...k.quellen.keys()]).toEqual(['td-zone-kreis']);
    entferneKreisVorschau(k.map);
    expect(k.ids()).toEqual([]);
    expect(k.quellen.size).toBe(0);
  });

  it('die Messung hat eigene Ebenen ohne Mitte, unter der Zeichnung von terra-draw', () => {
    const k = stilKarteAttrappe([
      'grund',
      'td-mess-polygon',
      'td-mess-linestring',
      'td-mess-point',
    ]);
    sorgeFuerKreisVorschau(k.map, kreis, MESS_KREIS_EBENEN);
    expect(k.ids()).toEqual([
      'grund',
      'td-mess-kreis-flaeche',
      'td-mess-kreis-linie',
      'td-mess-polygon',
      'td-mess-linestring',
      'td-mess-point',
    ]);
    expect(k.ebenen[1].paint).toMatchObject({ 'fill-color': '#123456' });
    // Nachführen legt nichts doppelt an und setzt die Farbe.
    sorgeFuerKreisVorschau(k.map, { ...kreis, radiusM: 500, farbe: '#654321' }, MESS_KREIS_EBENEN);
    expect(k.ids()).toHaveLength(6);
    expect(k.ebenen[2].paint).toMatchObject({ 'line-color': '#654321' });
    // Der Abbau nimmt nur die eigenen Ebenen, nie die des Zonen-Kreises oder von terra-draw.
    sorgeFuerKreisVorschau(k.map, kreis);
    entferneKreisVorschau(k.map, MESS_KREIS_EBENEN);
    expect(k.ids()).toEqual([
      'grund',
      'td-mess-polygon',
      'td-mess-linestring',
      'td-mess-point',
      'td-zone-kreis-flaeche',
      'td-zone-kreis-linie',
      'td-zone-kreis-mitte',
    ]);
    expect([...k.quellen.keys()]).toEqual(['td-zone-kreis']);
  });

  it('ohne Zeichnung von terra-draw liegen die Mess-Ebenen oben', () => {
    const k = stilKarteAttrappe(['grund']);
    sorgeFuerKreisVorschau(k.map, kreis, MESS_KREIS_EBENEN);
    expect(k.ids()).toEqual(['grund', 'td-mess-kreis-flaeche', 'td-mess-kreis-linie']);
  });

  it('jede Vorschau-Ebene trägt den Zeichnungs-Präfix, die Eigenposition bleibt darunter', () => {
    for (const e of [KREIS_VORSCHAU_EBENEN, MESS_KREIS_EBENEN]) {
      for (const id of [e.quelle, e.flaeche, e.linie, e.mitte].filter(Boolean))
        expect(id?.startsWith(ZEICHNUNG_PRAEFIX)).toBe(true);
    }
  });
});
