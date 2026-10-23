import { describe, expect, it } from 'vitest';
import type { Sprechgruppe } from '../api/types';
import * as modul from './kommunikationsmittel';
import { mitBetriebsart, teileSprechgruppen } from './kommunikationsmittel';

function sg(id: number, betriebsart: 'TMO' | 'DMO'): Sprechgruppe {
  return {
    id,
    bezeichnung: `${betriebsart} ${id}`,
    betriebsart,
    aktiv: true,
    einsatz_lokal: false,
    sortier: id,
  };
}

describe('Kommunikationsmittel (LLH-1134)', () => {
  it('gibt es nicht mehr: Telefon und weitere Verbindungen sind typisiert (`verbindungen.ts`)', () => {
    expect(Object.keys(modul).sort()).toEqual(['mitBetriebsart', 'teileSprechgruppen']);
  });
});

describe('teileSprechgruppen', () => {
  it('trennt nach Betriebsart und hält die Reihenfolge', () => {
    const { tmo, dmo } = teileSprechgruppen([sg(1, 'TMO'), sg(2, 'DMO'), sg(3, 'TMO')]);
    expect(tmo.map((s) => s.id)).toEqual([1, 3]);
    expect(dmo.map((s) => s.id)).toEqual([2]);
  });

  it('nimmt null als leer', () => {
    expect(teileSprechgruppen(null)).toEqual({ tmo: [], dmo: [] });
  });
});

describe('mitBetriebsart', () => {
  it('setzt die Betriebsart vor eine Bezeichnung ohne sie', () => {
    expect(mitBetriebsart('TMO', '311')).toBe('TMO 311');
    expect(mitBetriebsart('DMO', '505')).toBe('DMO 505');
  });

  it('lässt eine Bezeichnung, die sie schon trägt, wie sie ist (ohne Groß-/Kleinunterscheidung)', () => {
    expect(mitBetriebsart('TMO', 'TMO 412_F_DRK')).toBe('TMO 412_F_DRK');
    expect(mitBetriebsart('DMO', ' dmo 505')).toBe(' dmo 505');
  });

  it('prüft nur die eigene Betriebsart', () => {
    expect(mitBetriebsart('TMO', 'DMO 505')).toBe('TMO DMO 505');
  });
});
