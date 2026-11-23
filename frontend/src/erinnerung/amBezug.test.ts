import { describe, expect, it } from 'vitest';
import { amBezugGetragen } from './amBezug';

const alleFrei = () => true;
const auto = (bezug_typ: string, bezug_id: number | null = 7) => ({
  quelle: 'auto_frist',
  bezug_typ,
  bezug_id,
});

describe('amBezugGetragen (LLH-1908)', () => {
  it('trägt die automatische Frist von Meldung, Auftrag und Ablösung am Bezug', () => {
    for (const typ of ['meldung', 'auftrag', 'abloesung', 'abloesung_vorwarnung']) {
      expect(amBezugGetragen(auto(typ), alleFrei), typ).toBe(true);
    }
  });

  it('lässt den Planungshinweis der Ablösung eine Erinnerung', () => {
    expect(amBezugGetragen(auto('abloesung_planung'), alleFrei)).toBe(false);
  });

  it('lässt eine selbst angelegte Erinnerung mit Bezug eine Erinnerung', () => {
    expect(
      amBezugGetragen({ quelle: 'manuell', bezug_typ: 'meldung', bezug_id: 7 }, alleFrei),
    ).toBe(false);
  });

  it('trägt die Frist nur am Bezug, wenn dessen Modul frei ist', () => {
    const ohneMeldungen = (m: string) => m !== 'meldungen';
    expect(amBezugGetragen(auto('meldung'), ohneMeldungen)).toBe(false);
    expect(amBezugGetragen(auto('auftrag'), ohneMeldungen)).toBe(true);
  });

  it('trägt die Frist nur, solange ihr Bezug offen in seinem Modul steht', () => {
    const nurSieben = (_m: string, id: number) => id === 7;
    expect(amBezugGetragen(auto('auftrag', 7), nurSieben)).toBe(true);
    expect(amBezugGetragen(auto('auftrag', 8), nurSieben)).toBe(false);
    expect(amBezugGetragen(auto('auftrag', null), alleFrei)).toBe(false);
  });
});
