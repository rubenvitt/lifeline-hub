import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RICHTWERTE_BASIS, ZELTTYPEN, mitOverrides } from './richtwerte';

/**
 * Guard (LLH-1520, design.md Risiken): jeder Schlüssel der Basis-Datei wird vom Rechenkern gelesen,
 * und jeder Basiswert liegt in seinen eigenen Grenzen. Ein Schlüssel, den niemand liest, wäre in
 * Stammdaten und Einsatz-Einstellungen einstellbar, ohne zu wirken.
 */
const kern = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'rechnerKern.ts'), 'utf8');

describe('Basis-Richtwerte (src/unterkunft/richtwerte_basis.json)', () => {
  it('jeder Schlüssel wird im Rechenkern gelesen', () => {
    const zeltSchluessel = /^zelt_(sg\d+)_(schlafplaetze|garnituren|laenge_m|breite_m)$/;
    for (const r of RICHTWERTE_BASIS) {
      const z = zeltSchluessel.exec(r.schluessel);
      if (z) {
        expect(ZELTTYPEN.map((t) => t.typ)).toContain(z[1]);
        expect(kern).toContain(`_${z[2]}\``);
      } else {
        expect(kern, r.schluessel).toContain(`'${r.schluessel}'`);
      }
    }
  });

  it('Schlüssel sind eindeutig, snake_case, Basis liegt in den Grenzen', () => {
    const gesehen = new Set<string>();
    for (const r of RICHTWERTE_BASIS) {
      expect(gesehen.has(r.schluessel), r.schluessel).toBe(false);
      gesehen.add(r.schluessel);
      expect(r.schluessel).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(r.min).toBeLessThanOrEqual(r.wert);
      expect(r.wert).toBeLessThanOrEqual(r.max);
      if (r.ganzzahl) expect(Number.isInteger(r.wert), r.schluessel).toBe(true);
      expect(['belegt', 'annahme']).toContain(r.herkunft);
      expect(r.quelle.length).toBeGreaterThan(0);
    }
  });

  it('jeder Zelttyp hat alle vier Werte', () => {
    for (const { typ } of ZELTTYPEN) {
      for (const teil of ['schlafplaetze', 'garnituren', 'laenge_m', 'breite_m']) {
        expect(gesehenSchluessel()).toContain(`zelt_${typ}_${teil}`);
      }
    }
  });

  it('Overrides: unbekannte Schlüssel und null erben', () => {
    const rw = mitOverrides({ foo: 1, flaeche_je_person_m2: null }, { wasser_je_person_l: 15 });
    expect(rw.foo).toBeUndefined();
    expect(rw.flaeche_je_person_m2).toBe(4);
    expect(rw.wasser_je_person_l).toBe(15);
  });
});

function gesehenSchluessel() {
  return RICHTWERTE_BASIS.map((r) => r.schluessel);
}
