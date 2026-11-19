import { afterEach, describe, expect, it } from 'vitest';
import type { PraesenzStand } from '../api/types';
import {
  FENSTER_ID,
  leerePraesenz,
  praesenzAnderer,
  praesenzListener,
  praesenzSatz,
  praesenzStand,
  type PraesenzSchluessel,
} from './praesenz';

const ICH = 7;

function stand(eintraege: PraesenzStand['eintraege'], einsatz_id = 1): PraesenzStand {
  return { einsatz_id, eintraege };
}

function eintrag(
  benutzer_id: number,
  fenster: string,
  felder: string[],
  von = `B${benutzer_id}`,
): PraesenzStand['eintraege'][number] {
  return { objekt: 'einsatz', felder, benutzer_id, von, fenster };
}

const leitstelle: PraesenzSchluessel = {
  einsatzId: 1,
  objekt: 'einsatz',
  felder: ['leitstellen_nr'],
};

function senden(daten: unknown): void {
  const [[name, listener]] = praesenzListener(1);
  expect(name).toBe('praesenz');
  listener(new MessageEvent('praesenz', { data: JSON.stringify(daten) }));
}

afterEach(() => leerePraesenz(1));

describe('praesenzSatz', () => {
  it('nennt die Wortlaute des Entwurfs', () => {
    expect(praesenzSatz([], false)).toBeNull();
    expect(praesenzSatz(['Anna'], false)).toBe('Wird gerade bearbeitet von Anna');
    expect(praesenzSatz(['Anna', 'Ben'], false)).toBe('Wird gerade bearbeitet von Anna und Ben');
    expect(praesenzSatz(['Anna', 'Ben', 'Cem'], false)).toBe(
      'Wird gerade bearbeitet von Anna und 2 weiteren',
    );
    expect(praesenzSatz([], true)).toBe('Wird gerade von dir in einem anderen Fenster bearbeitet');
    expect(praesenzSatz(['Anna'], true)).toBe(
      'Wird gerade bearbeitet von Anna und von dir in einem anderen Fenster',
    );
  });
});

describe('praesenzAnderer', () => {
  it('nimmt das eigene Fenster aus und erkennt das eigene Konto in einem anderen als „du“', () => {
    const s = stand([
      eintrag(ICH, FENSTER_ID, ['leitstellen_nr']),
      eintrag(ICH, 'anderes-fenster', ['leitstellen_nr']),
    ]);
    expect(praesenzAnderer(s, leitstelle, undefined, ICH)).toEqual({ andere: [], du: true });
  });

  it('trifft eine Zeile, deren Feld in den Feldern eines Eintrags steht', () => {
    const s = stand([eintrag(2, 'f', ['einsatzort', 'einsatzort_koordinate'], 'Anna')]);
    const koordinate: PraesenzSchluessel = {
      einsatzId: 1,
      objekt: 'einsatz',
      felder: ['einsatzort_koordinate'],
    };
    expect(praesenzAnderer(s, koordinate, 'einsatzort_koordinate', ICH).andere).toEqual(['Anna']);
    expect(praesenzAnderer(s, leitstelle, undefined, ICH).andere).toEqual([]);
  });

  it('unterscheidet Objekt und Einheit', () => {
    const s = stand([
      { ...eintrag(2, 'f', ['bemerkung'], 'Anna'), objekt: 'einheit', einheit_id: 5 },
    ]);
    const e5: PraesenzSchluessel = {
      einsatzId: 1,
      objekt: 'einheit',
      einheitId: 5,
      felder: ['bemerkung'],
    };
    const e6: PraesenzSchluessel = { ...e5, einheitId: 6 };
    expect(praesenzAnderer(s, e5, undefined, ICH).andere).toEqual(['Anna']);
    expect(praesenzAnderer(s, e6, undefined, ICH).andere).toEqual([]);
  });

  it('nennt einen Namen mit zwei Fenstern nur einmal', () => {
    const s = stand([
      eintrag(2, 'f1', ['leitstellen_nr'], 'Anna'),
      eintrag(2, 'f2', ['leitstellen_nr'], 'Anna'),
    ]);
    expect(praesenzAnderer(s, leitstelle, undefined, ICH).andere).toEqual(['Anna']);
  });
});

describe('Store und Listener', () => {
  it('übernimmt den Stand des eigenen Einsatzes und leert ihn beim Abbruch', () => {
    senden(stand([eintrag(2, 'f', ['leitstellen_nr'], 'Anna')]));
    expect(praesenzStand(1)?.eintraege).toHaveLength(1);
    leerePraesenz(1);
    expect(praesenzStand(1)).toBeUndefined();
  });

  it('ignoriert den Stand eines anderen Einsatzes und unlesbare Daten', () => {
    senden(stand([eintrag(2, 'f', ['leitstellen_nr'])], 99));
    expect(praesenzStand(1)).toBeUndefined();
    const [[, listener]] = praesenzListener(1);
    listener(new MessageEvent('praesenz', { data: '{kaputt' }));
    expect(praesenzStand(1)).toBeUndefined();
  });
});
