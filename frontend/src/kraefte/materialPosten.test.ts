import { describe, expect, it } from 'vitest';
import type { MaterialStatus } from '../api/types';
import { materialStatus } from '../theme/statusFarben';
import {
  isAufgebraucht,
  materialDarstellung,
  materialStatusOptionen,
  mengeText,
  ortText,
  ortVon,
  type OrtNamen,
} from './materialPosten';

const ALLE: MaterialStatus[] = [
  'einsatzbereit',
  'im_einsatz',
  'defekt',
  'verbraucht',
  'desinfektion_noetig',
];

const geraet = { art: 'geraet' as const, menge: 1, ausgegeben: 0 };
const decke = (ausgegeben: number, menge = 50) => ({
  art: 'verbrauchsgut' as const,
  menge,
  ausgegeben,
});

describe('isAufgebraucht (LLH-1224 D4)', () => {
  it('ein Verbrauchsgut ist aufgebraucht, wenn alles ausgegeben ist', () => {
    expect(isAufgebraucht(decke(50))).toBe(true);
    expect(isAufgebraucht(decke(49))).toBe(false);
    expect(isAufgebraucht(decke(0))).toBe(false);
  });

  it('ein Gerät ist nie aufgebraucht', () => {
    expect(isAufgebraucht(geraet)).toBe(false);
    // Auch nicht, wenn die Zeile widersprüchlich wäre: die Art entscheidet.
    expect(isAufgebraucht({ art: 'geraet', menge: 1, ausgegeben: 1 })).toBe(false);
  });
});

describe('materialDarstellung (D15)', () => {
  it('nimmt den Vertrag `materialStatus` und baut keine eigene Karte', () => {
    for (const s of ALLE) {
      expect(materialDarstellung({ ...geraet, status: s })).toBe(materialStatus[s]);
    }
  });

  it('ein aufgebrauchtes Verbrauchsgut heißt „aufgebraucht“ in der Farbe von „verbraucht“', () => {
    const d = materialDarstellung({ ...decke(50), status: 'einsatzbereit' });
    expect(d.label).toBe('aufgebraucht');
    expect(d.rolle).toBe(materialStatus.verbraucht.rolle);
    expect(materialDarstellung({ ...decke(20), status: 'im_einsatz' })).toBe(
      materialStatus.im_einsatz,
    );
  });
});

describe('materialStatusOptionen (D3)', () => {
  it('Gerät alle fünf, Verbrauchsgut ohne „verbraucht“ und „Desinfektion nötig“', () => {
    expect(materialStatusOptionen('geraet')).toEqual(ALLE);
    expect(materialStatusOptionen('verbrauchsgut')).toEqual([
      'einsatzbereit',
      'im_einsatz',
      'defekt',
    ]);
  });
});

describe('mengeText (D15)', () => {
  it('Gerät „1“, Verbrauchsgut ohne Ausgabe die Menge, mit Ausgabe der Rest', () => {
    expect(mengeText(geraet)).toBe('1');
    expect(mengeText(decke(0))).toBe('50');
    expect(mengeText(decke(20))).toBe('30 von 50 übrig');
    expect(mengeText(decke(50))).toBe('0 von 50 übrig');
  });
});

describe('ortVon (D6/D15)', () => {
  it('liest genau einen der vier Orte, keiner heißt null', () => {
    expect(ortVon({ einheit_id: 3 })).toEqual({ art: 'einheit', id: 3 });
    expect(ortVon({ einsatz_fahrzeug_id: 4 })).toEqual({ art: 'fahrzeug', id: 4 });
    expect(ortVon({ uhs_id: 5, einheit_id: null })).toEqual({ art: 'uhs', id: 5 });
    expect(ortVon({ br_id: 6 })).toEqual({ art: 'bereitstellungsraum', id: 6 });
    expect(ortVon({})).toBeNull();
    expect(ortVon({ einheit_id: null, uhs_id: null, br_id: null })).toBeNull();
  });
});

describe('ortText (D11/D15)', () => {
  const namen: OrtNamen = {
    einheit: (id) => (id === 3 ? 'Rettungsstaffel' : undefined),
    fahrzeug: (id) => (id === 4 ? 'Florian 1/83-1' : undefined),
    uhs: (id) => (id === 5 ? 'Turnhalle' : id === 7 ? 'UHS Nord' : undefined),
    bereitstellungsraum: (id) => (id === 6 ? 'BR Nord' : undefined),
  };

  it('nennt jede Ortsart mit ihrem Namen, „ohne Ort“ ohne Ort', () => {
    expect(ortText({ art: 'einheit', id: 3 }, namen)).toBe('Rettungsstaffel');
    expect(ortText({ art: 'fahrzeug', id: 4 }, namen)).toBe('Florian 1/83-1');
    expect(ortText({ art: 'uhs', id: 5 }, namen)).toBe('UHS Turnhalle');
    expect(ortText({ art: 'uhs', id: 7 }, namen)).toBe('UHS Nord');
    expect(ortText({ art: 'bereitstellungsraum', id: 6 }, namen)).toBe('BR Nord');
    expect(ortText(null, namen)).toBe('ohne Ort');
  });

  it('ohne Leserecht oder unbekannten Namen steht „zugeordnet“, nie ein Strich', () => {
    expect(ortText({ art: 'einheit', id: 99 }, namen)).toBe('zugeordnet');
    expect(ortText({ art: 'bereitstellungsraum', id: 6 }, {})).toBe('zugeordnet');
  });
});
