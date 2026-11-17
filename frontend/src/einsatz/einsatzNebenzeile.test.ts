import { describe, expect, it } from 'vitest';
import { einsatzFixture } from '../test/fixtures';
import type { EinsatzAnzeige } from '../api/types';
import { einsatzNebenzeile as nebenzeile } from './einsatzNebenzeile';
import type { AnzeigeKonventionen } from '../anzeige/format';

const taktisch: AnzeigeKonventionen = { zeitzone: 'Europe/Berlin', zeitdarstellung: 'taktisch' };
const datumUhrzeit: AnzeigeKonventionen = {
  zeitzone: 'Europe/Berlin',
  zeitdarstellung: 'datum_uhrzeit',
};
const einsatzNebenzeile = (e: Parameters<typeof nebenzeile>[0]) => nebenzeile(e, taktisch);

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
    expect(einsatzNebenzeile(e)).toBe('Realeinsatz · seit 29mai26');
  });

  it('ohne Nummer steht der Beginn in der Darstellung der App, in ihrer Zone', () => {
    // 23:30 UTC am 13.11. ist in Berlin schon der 14.11.
    const e = einsatzFixture({ einsatzart: 'uebung', begonnen_at: '2026-11-13 23:30:00' });
    expect(nebenzeile(e, taktisch)).toBe('seit 14nov26');
    expect(nebenzeile(e, datumUhrzeit)).toBe('seit 14.11.26');
  });

  it('ohne Art (Altbestand ohne Feld), Nummer, Ort und Beginn: keine Nebenzeile', () => {
    const e = {
      ...einsatzFixture(),
      einsatzart: undefined,
      begonnen_at: '',
    } as unknown as EinsatzAnzeige;
    expect(einsatzNebenzeile(e)).toBeNull();
  });
});
