import { describe, expect, it } from 'vitest';
import type { Fuehrungsstelle } from '../api/types';
import { fuehrungsstelleErfasst } from './fuehrungsstelle';

const leer: Fuehrungsstelle = {
  art: 'mobil',
  sprechgruppen: [],
  verbindungen: [],
  fahrzeug_ids: [],
};

describe('fuehrungsstelleErfasst (LFH-1181)', () => {
  it('die Art allein macht die Führungsstelle nicht erfasst', () => {
    expect(fuehrungsstelleErfasst(leer)).toBe(false);
    expect(fuehrungsstelleErfasst({ ...leer, art: 'ortsfest' })).toBe(false);
  });

  it('Bezeichnung, Adresse oder Koordinate machen sie erfasst', () => {
    expect(fuehrungsstelleErfasst({ ...leer, bezeichnung: 'TEL Rathaus' })).toBe(true);
    expect(fuehrungsstelleErfasst({ ...leer, standort_adresse: 'Hauptstraße 1' })).toBe(true);
    expect(fuehrungsstelleErfasst({ ...leer, standort_lat: 52.1, standort_lon: 9.9 })).toBe(true);
  });

  // LLH-1134: eine Verbindung macht sie erfasst; ein Kommunikationsmittel ohne Nummer gibt es nicht mehr.
  it('eine Verbindung macht sie erfasst', () => {
    expect(
      fuehrungsstelleErfasst({
        ...leer,
        verbindungen: [{ id: 1, mittel: 'mobil', wert: '0171 1', hinweis: null }],
      }),
    ).toBe(true);
  });

  it('Leerzeichen zählen nicht', () => {
    expect(fuehrungsstelleErfasst({ ...leer, bezeichnung: '  ' })).toBe(false);
  });
});
