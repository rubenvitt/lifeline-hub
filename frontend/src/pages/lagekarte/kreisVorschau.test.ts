import { describe, expect, it } from 'vitest';
import { abstandM } from './geo';
import { griffLage, kreisVorschauDaten, mittenGriffSteht, radiusAusGriff } from './kreisVorschau';
import { KREIS_RADIUS_M_MAX } from '../../api/eingabegrenzen';

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
