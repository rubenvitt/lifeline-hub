import { describe, it, expect } from 'vitest';
import { FACHEBENEN, fachebeneKeys, istBboxAbhaengig, KRITIS_MIN_ZOOM } from './fachebenen';

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
