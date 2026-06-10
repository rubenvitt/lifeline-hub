import { describe, expect, it } from 'vitest';
import { METADATEN_FELDER, type MetaFeld } from './schnellerfassungModell';

describe('METADATEN_FELDER', () => {
  it('enthält genau die fünf Metadatenfelder in Anzeigereihenfolge', () => {
    expect(METADATEN_FELDER.map((f) => f.feld)).toEqual<MetaFeld[]>([
      'ereigniszeit', 'von', 'an', 'meldeweg', 'veranlassung',
    ]);
  });

  it('jedes Feld hat Label, Trigger-Keywords und Editor-Typ', () => {
    for (const def of METADATEN_FELDER) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.trigger.length).toBeGreaterThan(0);
      expect(['zeit', 'text', 'meldeweg']).toContain(def.editor);
    }
  });
});
