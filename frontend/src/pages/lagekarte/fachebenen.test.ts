import { describe, it, expect } from 'vitest';
import {
  FACHEBENEN,
  fachebeneKeys,
  istBboxAbhaengig,
  KRITIS_MIN_ZOOM,
  rasterBbox,
  mergeFeatures,
} from './fachebenen';

// Minimaler Feature-Builder für die Merge-Tests.
const feat = (lon: number, lat: number) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {},
});

describe('Fachebenen-Registry', () => {
  it('enthält die vier v1-Quellen', () => {
    expect(fachebeneKeys()).toEqual(['nina', 'dwd', 'pegelonline', 'kritis']);
  });
  it('markiert nur kritis als bbox-abhängig', () => {
    expect(istBboxAbhaengig('kritis')).toBe(true);
    expect(istBboxAbhaengig('dwd')).toBe(false);
  });
  it('jede Ebene hat Label, Farbe, Geometrietyp und Poll-Intervall', () => {
    for (const e of Object.values(FACHEBENEN)) {
      expect(e.label).toBeTruthy();
      expect(e.farbe).toMatch(/^#/);
      expect(['polygon', 'punkt']).toContain(e.geometrieTyp);
      expect(e.pollMs).toBeGreaterThanOrEqual(0);
    }
  });
  it('KRITIS_MIN_ZOOM ist eine sinnvolle Zoom-Schwelle (>= 10)', () => {
    expect(KRITIS_MIN_ZOOM).toBeGreaterThanOrEqual(10);
    expect(typeof KRITIS_MIN_ZOOM).toBe('number');
  });
});

describe('rasterBbox', () => {
  it('rastert nach außen auf das Gitter (benachbarte Pans → gleicher Schlüssel)', () => {
    // zwei leicht verschiedene Viewports in derselben Rasterzelle → identischer String
    const a = rasterBbox('6.96,50.91,6.99,50.94');
    const b = rasterBbox('6.97,50.92,6.98,50.93');
    expect(a).toBe(b);
    expect(a).toBe('6.95,50.9,7,50.95');
  });
  it('deckt den Ausschnitt vollständig ab (floor west/sued, ceil ost/nord)', () => {
    const [w, s, e, n] = rasterBbox('6.96,50.91,6.99,50.94').split(',').map(Number);
    expect(w).toBeLessThanOrEqual(6.96);
    expect(s).toBeLessThanOrEqual(50.91);
    expect(e).toBeGreaterThanOrEqual(6.99);
    expect(n).toBeGreaterThanOrEqual(50.94);
  });
  it('gibt ungültige Eingabe unverändert zurück', () => {
    expect(rasterBbox('kaputt')).toBe('kaputt');
  });
});

describe('mergeFeatures', () => {
  it('akkumuliert über mehrere Aufrufe und dedupliziert per Koordinate', () => {
    const m = new Map();
    expect(mergeFeatures(m, [feat(6.9, 50.9), feat(7.0, 51.0)], 100)).toBe(true);
    // anderer Ausschnitt mit einem überlappenden Punkt → nur der neue kommt dazu
    expect(mergeFeatures(m, [feat(7.0, 51.0), feat(8.0, 52.0)], 100)).toBe(true);
    expect(m.size).toBe(3); // 6.9/7.0/8.0, der doppelte 7.0 nur einmal
  });
  it('meldet keine Änderung, wenn nichts Neues dazukommt', () => {
    const m = new Map();
    mergeFeatures(m, [feat(6.9, 50.9)], 100);
    expect(mergeFeatures(m, [feat(6.9, 50.9)], 100)).toBe(false);
  });
  it('begrenzt die Größe (älteste zuerst raus)', () => {
    const m = new Map();
    mergeFeatures(m, [feat(1, 1), feat(2, 2), feat(3, 3)], 2);
    expect(m.size).toBe(2);
    expect(m.has(JSON.stringify([1, 1]))).toBe(false); // ältester entfernt
    expect(m.has(JSON.stringify([3, 3]))).toBe(true);
  });
});
