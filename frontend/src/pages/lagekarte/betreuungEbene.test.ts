import { describe, expect, it } from 'vitest';
import { betreuungZugriffVon } from './betreuungEbene';
import { modulRegistry } from '../../einsatz/modulRegistry';
import type { BenutzerAnzeige } from '../../api/types';

const MODUL = modulRegistry.find((m) => m.key === 'betreuung');
const mitglied = {
  id: 2,
  system_rolle: 'benutzer',
  org_rolle: 'keine',
} as unknown as BenutzerAnzeige;
const basis = {
  rechteBekannt: true,
  modul: MODUL,
  benutzer: mitglied,
  overrides: {},
  abgelehnt: false,
};

describe('betreuungZugriffVon (LFH-673)', () => {
  it('die Registry kennt das Modul — sonst prüfte alles hier ins Leere', () => {
    expect(MODUL?.key).toBe('betreuung');
  });
  it('frei, wenn das Modul sichtbar und nicht gesperrt ist', () => {
    expect(betreuungZugriffVon(basis)).toBe('frei');
  });
  it('ausgeblendet, solange die Rechte offen sind oder das Modul im Einsatz versteckt ist', () => {
    expect(betreuungZugriffVon({ ...basis, rechteBekannt: false })).toBe('ausgeblendet');
    expect(
      betreuungZugriffVon({
        ...basis,
        overrides: { betreuung: { einsatz_id: 1, modul_key: 'betreuung', sichtbar: false } },
      }),
    ).toBe('ausgeblendet');
  });
  it('gesperrt bei Rollen-Schranke im Client oder 403 vom Server', () => {
    expect(
      betreuungZugriffVon({
        ...basis,
        overrides: {
          betreuung: {
            einsatz_id: 1,
            modul_key: 'betreuung',
            sichtbar: true,
            benoetigte_rolle: 'fuehrungskraft',
          },
        },
      }),
    ).toBe('gesperrt');
    expect(betreuungZugriffVon({ ...basis, abgelehnt: true })).toBe('gesperrt');
  });
});
