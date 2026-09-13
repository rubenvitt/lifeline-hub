import { describe, it, expect } from 'vitest';
import {
  clusterTypProperties,
  donutSegmente,
  baueClusterDonut,
  CLUSTER_TYP_FARBE,
} from './clusterDonut';

describe('clusterTypProperties', () => {
  it('liefert für jeden clusterbaren Typ eine Summen-Aggregation c_<typ>', () => {
    const props = clusterTypProperties();
    for (const t of [
      'fahrzeug',
      'einheit',
      'fuehrung',
      'abschnitt',
      'uhs',
      'schaden',
      'lagemeldung',
    ]) {
      expect(props[`c_${t}`]).toBeDefined();
      // ['+', ['case', ['==', ['get','typ'], t], 1, 0]]
      expect(JSON.stringify(props[`c_${t}`])).toContain(t);
      expect(JSON.stringify(props[`c_${t}`]).startsWith('["+"')).toBe(true);
    }
    expect(props['c_einsatzort']).toBeUndefined(); // Einsatzort wird nie geclustert
  });
});

describe('donutSegmente', () => {
  it('liefert nur Typen mit count > 0, in stabiler Reihenfolge, mit Typ-Farbe', () => {
    const segs = donutSegmente({ point_count: 10, c_fahrzeug: 6, c_uhs: 0, c_schaden: 4 });
    expect(segs.map((s) => s.typ)).toEqual(['fahrzeug', 'schaden']); // uhs (0) raus, Reihenfolge fahrzeug<schaden
    expect(segs.find((s) => s.typ === 'fahrzeug')?.count).toBe(6);
    expect(segs.find((s) => s.typ === 'schaden')?.farbe).toBe(CLUSTER_TYP_FARBE.schaden);
  });

  it('ist leer, wenn keine Typ-Counts vorliegen', () => {
    expect(donutSegmente({ point_count: 3 })).toEqual([]);
  });
});

describe('baueClusterDonut', () => {
  it('rendert ein DOM-Element mit der Gesamtzahl als Text und conic-gradient-Ring', () => {
    const el = baueClusterDonut({ point_count: 12, c_fahrzeug: 8, c_schaden: 4 });
    expect(el.tagName).toBe('DIV');
    expect(el.style.background).toContain('conic-gradient');
    expect(el.textContent).toBe('12');
  });

  it('kürzt große Zahlen (≥1000) auf k-Notation', () => {
    const el = baueClusterDonut({ point_count: 1500, c_fahrzeug: 1500 });
    expect(el.textContent).toBe('1.5k');
  });
});
