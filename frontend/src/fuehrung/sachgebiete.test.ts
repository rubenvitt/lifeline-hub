import { describe, expect, it } from 'vitest';
import { mitWirksamemLabel, SACHGEBIETE } from './sachgebiete';

describe('SACHGEBIETE', () => {
  it('führt genau die sechs Sachgebiete in Anlage-2-Reihenfolge', () => {
    expect(SACHGEBIETE.map((s) => s.sachgebiet)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(SACHGEBIETE.map((s) => s.kuerzel)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  });

  /**
   * Die Labels sind DIESELBEN wie im System-ETB-Eintrag (`Sachgebiet::label`). Literale, sonst
   * prüfte der Test die Quelle gegen sich selbst.
   */
  it('benennt die Sachgebiete wie der System-ETB-Eintrag', () => {
    expect(SACHGEBIETE.map((s) => s.label)).toEqual([
      'Personal',
      'Lage',
      'Einsatz',
      'Versorgung',
      'Presse- und Medienarbeit',
      'Information und Kommunikation',
    ]);
  });
});

describe('mitWirksamemLabel (LFH-549)', () => {
  it('nimmt das Mandantenlabel aus dem Katalog, sonst das Standardlabel', () => {
    const zeilen = mitWirksamemLabel([
      {
        funktion: 's4',
        kuerzel: 'S4',
        label: 'Versorgung (Logistik)',
        standard_label: 'Versorgung',
        art: 'sachgebiet',
        bezeichnung_pflicht: false,
      },
    ]);
    expect(zeilen.find((z) => z.sachgebiet === 's4')?.label).toBe('Versorgung (Logistik)');
    expect(zeilen.find((z) => z.sachgebiet === 's2')?.label).toBe('Lage');
    expect(mitWirksamemLabel([]).map((z) => z.label)).toEqual(SACHGEBIETE.map((z) => z.label));
  });
});
