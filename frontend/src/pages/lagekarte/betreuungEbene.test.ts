import { describe, expect, it } from 'vitest';
import { betreuungZugriffVon } from './betreuungEbene';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { freigabenFixture } from '../../test/fixtures';

const MODUL = modulRegistry.find((m) => m.key === 'betreuung');
const basis = {
  modul: MODUL,
  freigaben: freigabenFixture(),
  abgelehnt: false,
};

describe('betreuungZugriffVon (LFH-673, Freigaben vom Server: LFH-669)', () => {
  it('die Registry kennt das Modul — sonst prüfte alles hier ins Leere', () => {
    expect(MODUL?.key).toBe('betreuung');
  });
  it('frei, wenn das Modul sichtbar und nicht gesperrt ist', () => {
    expect(betreuungZugriffVon(basis)).toBe('frei');
  });
  it('ausgeblendet, solange die Freigaben offen sind oder das Modul im Einsatz versteckt ist', () => {
    expect(betreuungZugriffVon({ ...basis, freigaben: undefined })).toBe('ausgeblendet');
    expect(
      betreuungZugriffVon({
        ...basis,
        freigaben: freigabenFixture({ betreuung: { sichtbar: false, zugriff: false } }),
      }),
    ).toBe('ausgeblendet');
  });
  it('gesperrt, wenn der Server den Zugriff verweigert oder die Übersicht mit 403 kommt', () => {
    expect(
      betreuungZugriffVon({
        ...basis,
        freigaben: freigabenFixture({ betreuung: { zugriff: false } }),
      }),
    ).toBe('gesperrt');
    expect(betreuungZugriffVon({ ...basis, abgelehnt: true })).toBe('gesperrt');
  });
});
