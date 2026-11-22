import { describe, expect, it } from 'vitest';
import { amBezugGetragen } from './amBezug';

const alleFrei = () => true;
const auto = (bezug_typ: string) => ({ quelle: 'auto_frist', bezug_typ });

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
    expect(amBezugGetragen({ quelle: 'manuell', bezug_typ: 'meldung' }, alleFrei)).toBe(false);
  });

  it('trägt die Frist nur am Bezug, wenn dessen Modul frei ist', () => {
    const ohneMeldungen = (m: string) => m !== 'meldungen';
    expect(amBezugGetragen(auto('meldung'), ohneMeldungen)).toBe(false);
    expect(amBezugGetragen(auto('auftrag'), ohneMeldungen)).toBe(true);
  });
});
