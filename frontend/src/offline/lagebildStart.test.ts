import { describe, expect, it } from 'vitest';
import type { BenutzerAnzeige } from '../api/types';
import type { LagebildDatensatz } from './lagebildSpeicher';
import { HOECHSTLIEGEZEIT_MS, startEntscheidung } from './lagebildStart';

const A = { id: 7, benutzername: 'a' } as BenutzerAnzeige;
const B = { id: 8, benutzername: 'b' } as BenutzerAnzeige;
const JETZT = 1_000_000_000;
const BUSTER = 'v1';

function satz(teil: Partial<LagebildDatensatz> = {}): LagebildDatensatz {
  return {
    benutzer: A,
    bestaetigtAt: JETZT - 60_000,
    buster: BUSTER,
    client: { timestamp: JETZT, buster: BUSTER, clientState: { queries: [], mutations: [] } },
    ...teil,
  };
}

describe('startEntscheidung (design.md D2)', () => {
  it('stellt bei bestätigter gleicher Identität wieder her', () => {
    expect(startEntscheidung({ art: 'ok', benutzer: A }, satz(), JETZT, BUSTER)).toEqual({
      benutzer: A,
      wiederherstellen: true,
      loeschen: false,
    });
  });

  it('löscht bei anderer Identität, veraltetem Stand oder anderem Buster', () => {
    const erwartet = { benutzer: B, wiederherstellen: false, loeschen: true };
    expect(startEntscheidung({ art: 'ok', benutzer: B }, satz(), JETZT, BUSTER)).toEqual(erwartet);
    expect(
      startEntscheidung(
        { art: 'ok', benutzer: A },
        satz({ bestaetigtAt: JETZT - HOECHSTLIEGEZEIT_MS - 1 }),
        JETZT,
        BUSTER,
      ),
    ).toEqual({ ...erwartet, benutzer: A });
    expect(startEntscheidung({ art: 'ok', benutzer: A }, satz(), JETZT, 'v2')).toEqual({
      ...erwartet,
      benutzer: A,
    });
  });

  it('legt ohne Datensatz nichts wieder her und löscht nichts', () => {
    expect(startEntscheidung({ art: 'ok', benutzer: A }, undefined, JETZT, BUSTER)).toEqual({
      benutzer: A,
      wiederherstellen: false,
      loeschen: false,
    });
  });

  it('löscht bei jeder Server-Ablehnung und bleibt anonym', () => {
    expect(startEntscheidung({ art: 'abgelehnt' }, satz(), JETZT, BUSTER)).toEqual({
      benutzer: null,
      wiederherstellen: false,
      loeschen: true,
    });
  });

  it('nimmt bei Netzfehler die gespeicherte Identität, wenn der Stand gültig ist', () => {
    expect(startEntscheidung({ art: 'netzfehler' }, satz(), JETZT, BUSTER)).toEqual({
      benutzer: A,
      wiederherstellen: true,
      loeschen: false,
    });
  });

  it('bleibt bei Netzfehler ohne gültigen Stand anonym wie bisher', () => {
    expect(startEntscheidung({ art: 'netzfehler' }, undefined, JETZT, BUSTER)).toEqual({
      benutzer: null,
      wiederherstellen: false,
      loeschen: false,
    });
    expect(
      startEntscheidung(
        { art: 'netzfehler' },
        satz({ bestaetigtAt: JETZT - HOECHSTLIEGEZEIT_MS - 1 }),
        JETZT,
        BUSTER,
      ),
    ).toEqual({ benutzer: null, wiederherstellen: false, loeschen: true });
    expect(startEntscheidung({ art: 'netzfehler' }, satz(), JETZT, 'v2')).toEqual({
      benutzer: null,
      wiederherstellen: false,
      loeschen: true,
    });
  });

  it('zählt genau 24 h noch als gültig, eine Millisekunde mehr nicht', () => {
    expect(HOECHSTLIEGEZEIT_MS).toBe(24 * 60 * 60 * 1000);
    const grenze = satz({ bestaetigtAt: JETZT - HOECHSTLIEGEZEIT_MS });
    expect(startEntscheidung({ art: 'netzfehler' }, grenze, JETZT, BUSTER).wiederherstellen).toBe(
      true,
    );
    expect(
      startEntscheidung({ art: 'netzfehler' }, grenze, JETZT + 1, BUSTER).wiederherstellen,
    ).toBe(false);
  });

  it('misst die Frist an der Bestätigung, nicht am Speicherzeitpunkt', () => {
    // Frisch gespeichert, aber seit 25 h ohne Server-Antwort: verwerfen.
    const alt = satz({ bestaetigtAt: JETZT - 25 * 60 * 60 * 1000 });
    alt.client.timestamp = JETZT;
    expect(startEntscheidung({ art: 'netzfehler' }, alt, JETZT, BUSTER).wiederherstellen).toBe(
      false,
    );
  });
});
