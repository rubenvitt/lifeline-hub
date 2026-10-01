import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GEDAECHTNIS_PRAEFIX,
  ladeGedaechtnis,
  speichereGedaechtnis,
  vergissRueckfall,
} from './unwetterGedaechtnis';

const EINTRAG = { 'schwer|DAUERREGEN': { stufe: 'schwer' as const, gesehenAt: 1000 } };

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vergissRueckfall();
});

describe('Unwetter-Gedächtnis', () => {
  it('liest, was es schrieb, unter dem Schlüssel je Person und Einsatz', () => {
    speichereGedaechtnis(7, 42, EINTRAG);
    expect(localStorage.getItem(`${GEDAECHTNIS_PRAEFIX}:7:42`)).not.toBeNull();
    expect(ladeGedaechtnis(7, 42)).toEqual(EINTRAG);
  });

  it('trennt Personen und Einsätze', () => {
    speichereGedaechtnis(7, 42, EINTRAG);
    expect(ladeGedaechtnis(8, 42)).toEqual({});
    expect(ladeGedaechtnis(7, 43)).toEqual({});
  });

  it('kaputtes JSON und fremde Formen gelten als leer, ungültige Einträge fallen weg', () => {
    localStorage.setItem(`${GEDAECHTNIS_PRAEFIX}:7:42`, '{kaputt');
    expect(ladeGedaechtnis(7, 42)).toEqual({});
    localStorage.setItem(`${GEDAECHTNIS_PRAEFIX}:7:42`, '[1,2]');
    expect(ladeGedaechtnis(7, 42)).toEqual({});
    localStorage.setItem(
      `${GEDAECHTNIS_PRAEFIX}:7:42`,
      JSON.stringify({
        ...EINTRAG,
        'x|A': { stufe: 'orkan', gesehenAt: 1 },
        'x|B': { stufe: 'schwer', gesehenAt: 'gestern' },
      }),
    );
    expect(ladeGedaechtnis(7, 42)).toEqual(EINTRAG);
  });

  it('ohne localStorage: Rückfall auf den Tab, kein Fehler nach außen', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    expect(ladeGedaechtnis(7, 42)).toEqual({});
    speichereGedaechtnis(7, 42, EINTRAG);
    expect(ladeGedaechtnis(7, 42)).toEqual(EINTRAG);
    expect(ladeGedaechtnis(7, 43)).toEqual({});
  });
});
