import { describe, expect, it } from 'vitest';
import type { MaterialStatus } from '../api/types';
import { materialStatus } from '../theme/statusFarben';
import {
  hoechsteTeilmenge,
  isAufgebraucht,
  materialDarstellung,
  materialStatusOptionen,
  mengeText,
  OHNE_ORT_WERT,
  ortPatch,
  ortText,
  ortVon,
  parseOrtValue,
  toOrtValue,
  type MaterialOrtRef,
  type OrtNamen,
  ortPostFields,
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

describe('hoechsteTeilmenge (LLH-1224 D14, t1hvaqzu D6)', () => {
  it('die Ausgangszeile behält mindestens eins, abgeteilt wird nur aus dem Rest', () => {
    expect(hoechsteTeilmenge(decke(0))).toBe(49);
    expect(hoechsteTeilmenge(decke(20))).toBe(30);
    expect(hoechsteTeilmenge(decke(40))).toBe(10);
  });
  it('aufgebraucht, Menge 1 und ein Gerät lassen sich nicht teilen', () => {
    expect(hoechsteTeilmenge(decke(50))).toBe(0);
    expect(hoechsteTeilmenge(decke(0, 1))).toBe(0);
    expect(hoechsteTeilmenge(geraet)).toBe(0);
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

describe('toOrtValue/parseOrtValue (LLH-1225 D2)', () => {
  it('schreibt jede Ortsart mit eigenem Präfix, weil die IDs der Ortsarten kollidieren', () => {
    expect(toOrtValue({ art: 'einheit', id: 12 })).toBe('einheit:12');
    expect(toOrtValue({ art: 'fahrzeug', id: 3 })).toBe('fahrzeug:3');
    expect(toOrtValue({ art: 'uhs', id: 4 })).toBe('uhs:4');
    expect(toOrtValue({ art: 'bereitstellungsraum', id: 2 })).toBe('br:2');
    expect(toOrtValue(null)).toBe('ohne');
  });

  it('liest jeden Wert zurück (Round-Trip)', () => {
    const orte: (MaterialOrtRef | null)[] = [
      { art: 'einheit', id: 12 },
      { art: 'fahrzeug', id: 3 },
      { art: 'uhs', id: 4 },
      { art: 'bereitstellungsraum', id: 2 },
      null,
    ];
    for (const ort of orte) expect(parseOrtValue(toOrtValue(ort))).toEqual(ort);
  });

  it('Unbekanntes ist undefined, nicht „ohne Ort“', () => {
    for (const s of [
      '',
      'einheit',
      'einheit:',
      'einheit:x',
      'einheit:-1',
      'einheit:1.5',
      'kfz:3',
      'ohne:1',
    ]) {
      expect(parseOrtValue(s)).toBeUndefined();
    }
  });
});

describe('ortPatch (LLH-1225 D2)', () => {
  const einheit: MaterialOrtRef = { art: 'einheit', id: 1 };
  it('setzt einen Ort, wo keiner war', () => {
    expect(ortPatch({ art: 'uhs', id: 7 }, null)).toEqual({ uhs_id: 7 });
  });
  it('wechselt den Ort mit EINEM Feld: der Server löst den bisherigen', () => {
    expect(ortPatch({ art: 'fahrzeug', id: 3 }, einheit)).toEqual({ einsatz_fahrzeug_id: 3 });
    expect(ortPatch({ art: 'bereitstellungsraum', id: 2 }, einheit)).toEqual({ br_id: 2 });
    expect(ortPatch({ art: 'einheit', id: 2 }, einheit)).toEqual({ einheit_id: 2 });
  });
  it('löst den Ort über das Feld des bisherigen', () => {
    expect(ortPatch(null, einheit)).toEqual({ einheit_id: null });
    expect(ortPatch(null, { art: 'bereitstellungsraum', id: 2 })).toEqual({ br_id: null });
  });
  it('gleicher Ort oder ohne zu ohne sendet nichts', () => {
    expect(ortPatch({ art: 'einheit', id: 1 }, einheit)).toBeNull();
    expect(ortPatch(null, null)).toBeNull();
  });
});

describe('ortPostFields (LLH-1225 D7, LLH-1226)', () => {
  it('ein Ort wird sein Feld, „ohne Ort“ und Unbekanntes senden keins', () => {
    expect(ortPostFields('einheit:3')).toEqual({ einheit_id: 3 });
    expect(ortPostFields('br:2')).toEqual({ br_id: 2 });
    expect(ortPostFields(OHNE_ORT_WERT)).toBeUndefined();
    expect(ortPostFields('quatsch')).toBeUndefined();
    expect(ortPostFields(undefined)).toBeUndefined();
  });
});
