import { describe, expect, it } from 'vitest';
import type { Bereitschaft } from '../api/types';
import { bewerteBereitschaft } from './bereitschaft';

const leer: Bereitschaft = {
  benutzer: 0,
  fahrzeuge: 0,
  fahrzeuge_demo: 0,
  personal: 0,
  personal_demo: 0,
  einheit_vorlagen: 0,
  einheit_vorlagen_demo: 0,
  einsatz_vorlagen: 0,
};

function zustaende(b: Bereitschaft) {
  return Object.fromEntries(bewerteBereitschaft(b).zeilen.map((z) => [z.key, z.zustand]));
}

describe('bewerteBereitschaft (LLH-1820)', () => {
  it('nur ich: weitere Benutzer und Fahrzeuge oder Personal fehlen', () => {
    const b = { ...leer, benutzer: 1 };
    const w = bewerteBereitschaft(b);
    expect(w.fehlt).toEqual(['weitere Benutzer', 'Fahrzeuge oder Personal']);
    expect(w.satz).toBe('Für einen Einsatz fehlt: weitere Benutzer, Fahrzeuge oder Personal.');
    expect(zustaende(b)).toEqual({
      benutzer: 'fehlt',
      fahrzeuge: 'fehlt',
      personal: 'fehlt',
      einheit_vorlagen: 'empfohlen',
      einsatz_vorlagen: 'empfohlen',
    });
  });

  it('Fahrzeuge allein genügen; Personal ist dann eine Empfehlung', () => {
    const b = { ...leer, benutzer: 2, fahrzeuge: 1 };
    const w = bewerteBereitschaft(b);
    expect(w.fehlt).toEqual([]);
    expect(w.satz).toBe('Bereit für einen Einsatz.');
    expect(zustaende(b)).toMatchObject({ fahrzeuge: 'vorhanden', personal: 'empfohlen' });
  });

  it('nur_demo_ist_nicht_bereit', () => {
    const b = { ...leer, benutzer: 2, fahrzeuge_demo: 5, personal_demo: 9 };
    const w = bewerteBereitschaft(b);
    expect(w.fehlt).toEqual(['Fahrzeuge oder Personal']);
    expect(w.satz).toBe('Für einen Einsatz fehlt: Fahrzeuge oder Personal.');
    const demo = Object.fromEntries(w.zeilen.map((z) => [z.key, z.demo]));
    expect(demo).toMatchObject({ fahrzeuge: 5, personal: 9 });
  });

  it('alles da: bereit, alle Zeilen vorhanden, feste Reihenfolge und Labels', () => {
    const b: Bereitschaft = {
      ...leer,
      benutzer: 3,
      fahrzeuge: 2,
      personal: 4,
      einheit_vorlagen: 2,
      einsatz_vorlagen: 2,
    };
    const w = bewerteBereitschaft(b);
    expect(w.fehlt).toEqual([]);
    expect(w.satz).toBe('Bereit für einen Einsatz.');
    expect(w.zeilen.map((z) => [z.label, z.zahl, z.zustand])).toEqual([
      ['Benutzer', 3, 'vorhanden'],
      ['Fahrzeuge', 2, 'vorhanden'],
      ['Personal', 4, 'vorhanden'],
      ['Einheiten-Vorlagen', 2, 'vorhanden'],
      ['Einsatz-Vorlagen', 2, 'vorhanden'],
    ]);
  });
});
