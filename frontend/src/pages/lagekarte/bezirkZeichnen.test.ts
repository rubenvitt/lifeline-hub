import { describe, expect, it } from 'vitest';
import { bezirkAuftragEntschieden, bezirkZeichnenEntwurf } from './bezirkZeichnen';

const UFER = { id: 5, bezeichnung: 'Uferstraße 12–40' };
const ENTWURF = { typ: 'evakuierungsbezirk' as const, modus: 'polygon' as const };

describe('bezirkZeichnenEntwurf (LLH-1069)', () => {
  it('trägt den Bezirk mit Kennung und Bezeichnung in den Entwurf', () => {
    expect(bezirkZeichnenEntwurf(ENTWURF, 5, { evakuierungFrei: true, bezirke: [UFER] })).toEqual({
      ...ENTWURF,
      bezirk: { id: 5, bezeichnung: 'Uferstraße 12–40' },
    });
  });

  it('unbekannter, fremder oder stornierter Bezirk (fehlt in der Liste): kein Entwurf', () => {
    expect(
      bezirkZeichnenEntwurf(ENTWURF, 77, { evakuierungFrei: true, bezirke: [UFER] }),
    ).toBeNull();
  });

  it('ohne Freigabe des Moduls Evakuierung: kein Entwurf, auch wenn die Liste ihn kennt', () => {
    expect(
      bezirkZeichnenEntwurf(ENTWURF, 5, { evakuierungFrei: false, bezirke: [UFER] }),
    ).toBeNull();
  });

  it('nur am Typ Evakuierungsbezirk', () => {
    expect(
      bezirkZeichnenEntwurf({ typ: 'gefahrengebiet', modus: 'polygon' }, 5, {
        evakuierungFrei: true,
        bezirke: [UFER],
      }),
    ).toBeNull();
  });
});

describe('bezirkAuftragEntschieden (LLH-1069)', () => {
  it('wartet auf die Freigaben', () => {
    expect(
      bezirkAuftragEntschieden({
        rechteBekannt: false,
        evakuierungFrei: false,
        bezirkeGeladen: false,
      }),
    ).toBe(false);
  });
  it('bei freiem Modul auf die Bezirksliste', () => {
    expect(
      bezirkAuftragEntschieden({
        rechteBekannt: true,
        evakuierungFrei: true,
        bezirkeGeladen: false,
      }),
    ).toBe(false);
    expect(
      bezirkAuftragEntschieden({
        rechteBekannt: true,
        evakuierungFrei: true,
        bezirkeGeladen: true,
      }),
    ).toBe(true);
  });
  it('bei gesperrtem Modul steht das Urteil ohne Liste fest', () => {
    expect(
      bezirkAuftragEntschieden({
        rechteBekannt: true,
        evakuierungFrei: false,
        bezirkeGeladen: false,
      }),
    ).toBe(true);
  });
});
