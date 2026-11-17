import { describe, expect, it } from 'vitest';
import { einsatzFixture } from '../test/fixtures';
import type { EinsatzAnzeige } from '../api/types';
import { einsatzNebenzeile } from './einsatzNebenzeile';

describe('einsatzNebenzeile (LLH-1821, D2)', () => {
  it('nennt Einsatzart, Nummer und Ort', () => {
    const e = einsatzFixture({
      einsatzart: 'sanitaetsdienst',
      einsatznummer_intern: 'E-2026-0431',
      einsatzort: 'Markt',
    });
    expect(einsatzNebenzeile(e)).toBe('Sanitätsdienst · E-2026-0431 · Markt');
  });

  it('lässt bei einer Übung die Art weg, die Marke nennt sie schon', () => {
    const e = einsatzFixture({ einsatzart: 'uebung', leitstellen_nr: '4711', einsatzort: 'Markt' });
    expect(einsatzNebenzeile(e)).toBe('4711 · Markt');
  });

  it('lässt fehlende Teile aus, ohne leere Trenner', () => {
    const e = einsatzFixture({ einsatzart: 'realeinsatz', einsatzort: '  ' });
    expect(einsatzNebenzeile(e)).toBe('Realeinsatz');
  });

  it('ohne Art (Altbestand ohne Feld), Nummer und Ort: keine Nebenzeile', () => {
    const e = { ...einsatzFixture(), einsatzart: undefined } as unknown as EinsatzAnzeige;
    expect(einsatzNebenzeile(e)).toBeNull();
  });
});
