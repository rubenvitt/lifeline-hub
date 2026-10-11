import { describe, expect, it } from 'vitest';
import type { Einsatzabschnitt } from '../../api/types';
import { findKurzbezeichnungKonflikt } from './kurzbezeichnung';

const abschnitt = (id: number, name: string, kurzbezeichnung: string | null) =>
  ({ id, name, kurzbezeichnung }) as Einsatzabschnitt;

const bestand = [abschnitt(1, 'Abschnitt Nord', 'EA 1'), abschnitt(2, 'Süd', null)];

describe('findKurzbezeichnungKonflikt (LFH-1208)', () => {
  it('findet eine vergebene Kurzbezeichnung ohne Rücksicht auf Groß-/Kleinschreibung', () => {
    expect(findKurzbezeichnungKonflikt(bestand, 'ea 1', 2)?.name).toBe('Abschnitt Nord');
  });

  it('trimmt wie der Server', () => {
    expect(findKurzbezeichnungKonflikt(bestand, '  EA 1 ', undefined)?.name).toBe('Abschnitt Nord');
  });

  it('der eigene Abschnitt ist kein Konflikt', () => {
    expect(findKurzbezeichnungKonflikt(bestand, 'EA 1', 1)).toBeUndefined();
  });

  it('ein leerer Wert ist nie ein Konflikt', () => {
    expect(findKurzbezeichnungKonflikt(bestand, '', 2)).toBeUndefined();
    expect(findKurzbezeichnungKonflikt(bestand, '   ', 2)).toBeUndefined();
  });

  it('faltet nur A–Z wie SQLite NOCASE, keine Umlaute', () => {
    const mitUmlaut = [abschnitt(3, 'Über', 'Ü1')];
    expect(findKurzbezeichnungKonflikt(mitUmlaut, 'ü1', 2)).toBeUndefined();
  });
});
