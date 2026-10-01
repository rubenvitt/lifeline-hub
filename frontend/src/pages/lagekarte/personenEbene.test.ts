import { describe, expect, it } from 'vitest';
import { personenZugriffVon } from './personenEbene';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { freigabenFixture } from '../../test/fixtures';

const MODUL = modulRegistry.find((m) => m.key === 'personen');
const basis = {
  istSnapshot: false,
  modul: MODUL,
  freigaben: freigabenFixture(),
  abgelehnt: false,
};

describe('personenZugriffVon (LFH-648, Freigaben vom Server: LFH-669)', () => {
  it('die Registry kennt das Modul — sonst prüfte alles hier ins Leere', () => {
    expect(MODUL?.key).toBe('personen');
  });

  it('frei, wenn der Server das Modul sichtbar und frei meldet', () => {
    expect(personenZugriffVon(basis)).toBe('frei');
  });

  it('ausgeblendet, solange die Freigaben unbekannt sind — keine Anfrage auf Verdacht', () => {
    expect(personenZugriffVon({ ...basis, freigaben: undefined })).toBe('ausgeblendet');
  });

  it('ausgeblendet, wenn der Einsatz das Modul ausblendet', () => {
    expect(
      personenZugriffVon({
        ...basis,
        freigaben: freigabenFixture({ personen: { sichtbar: false, zugriff: false } }),
      }),
    ).toBe('ausgeblendet');
  });

  it('gesperrt, wenn der Server den Zugriff verweigert (etwa per Org-Vorgabe)', () => {
    expect(
      personenZugriffVon({
        ...basis,
        freigaben: freigabenFixture({ personen: { zugriff: false } }),
      }),
    ).toBe('gesperrt');
  });

  it('gesperrt, wenn die Liste trotz Freigabe mit 403 kommt — das Netz bleibt', () => {
    expect(personenZugriffVon({ ...basis, abgelehnt: true })).toBe('gesperrt');
  });

  it('Rückblick erst nach Sichtbarkeit und Sperre', () => {
    expect(personenZugriffVon({ ...basis, istSnapshot: true })).toBe('rueckblick');
    expect(
      personenZugriffVon({
        ...basis,
        istSnapshot: true,
        freigaben: freigabenFixture({ personen: { zugriff: false } }),
      }),
    ).toBe('gesperrt');
  });
});
