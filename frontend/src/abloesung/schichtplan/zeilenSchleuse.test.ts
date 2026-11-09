import { describe, expect, it } from 'vitest';
import type { RasterZeile } from './raster';
import { schleusenKurz, schleusenText, schleuseZeilen } from './zeilenSchleuse';

const zeile = (schluessel: string, titel: string, gruppe: string | null = 'Nord'): RasterZeile => ({
  schluessel,
  titel,
  gruppe,
});
const PAUSE: RasterZeile = {
  schluessel: 'pause',
  titel: 'Pause',
  gruppe: null,
  ueberlappungErlaubt: true,
};

const GEZEIGT = [zeile('einheit:1', 'RTW 1'), zeile('einheit:2', 'Streife 2'), PAUSE];
const schluessel = (zeilen: readonly RasterZeile[]) => zeilen.map((z) => z.schluessel);

describe('schleuseZeilen (LLH-1604)', () => {
  it('ohne Änderung stehen die Zeilen wie gezeigt, nichts wartet', () => {
    const { zeilen, wartend } = schleuseZeilen(GEZEIGT, GEZEIGT);
    expect(zeilen).toEqual(GEZEIGT);
    expect(wartend).toEqual({ neu: 0, entfallen: 0, umsortiert: false });
  });

  it('ein neuer Posten vorn wartet und ist keine Umsortierung', () => {
    const frisch = [zeile('einheit:9', 'KTW 9'), ...GEZEIGT];
    const { zeilen, wartend } = schleuseZeilen(GEZEIGT, frisch);
    expect(schluessel(zeilen)).toEqual(['einheit:1', 'einheit:2', 'pause']);
    expect(wartend).toEqual({ neu: 1, entfallen: 0, umsortiert: false });
  });

  it('ein entfallener Posten bleibt als leere Zeile aus dem Gezeigten stehen', () => {
    const frisch = [zeile('einheit:2', 'Streife 2'), PAUSE];
    const { zeilen, wartend } = schleuseZeilen(GEZEIGT, frisch);
    expect(schluessel(zeilen)).toEqual(['einheit:1', 'einheit:2', 'pause']);
    expect(zeilen[0]).toEqual({ ...GEZEIGT[0], entfallen: true });
    expect(zeilen[1].entfallen).toBeUndefined();
    expect(wartend).toEqual({ neu: 0, entfallen: 1, umsortiert: false });
  });

  it('eine fremde Umsortierung hält die gezeigte Folge', () => {
    const frisch = [zeile('einheit:2', 'Streife 2'), zeile('einheit:1', 'RTW 1'), PAUSE];
    const { zeilen, wartend } = schleuseZeilen(GEZEIGT, frisch);
    expect(schluessel(zeilen)).toEqual(['einheit:1', 'einheit:2', 'pause']);
    expect(wartend.umsortiert).toBe(true);
  });

  it('ein umgehängter Posten behält seine gezeigte Gruppe und zählt als Umsortierung', () => {
    const frisch = [zeile('einheit:1', 'RTW 1', 'Süd'), zeile('einheit:2', 'Streife 2'), PAUSE];
    const { zeilen, wartend } = schleuseZeilen(GEZEIGT, frisch);
    expect(zeilen[0].gruppe).toBe('Nord');
    expect(wartend.umsortiert).toBe(true);
  });

  it('der Titel kommt frisch', () => {
    const frisch = [
      zeile('einheit:1', 'RTW 1 (aufgelöst)'),
      zeile('einheit:2', 'Streife 2'),
      PAUSE,
    ];
    const { zeilen, wartend } = schleuseZeilen(GEZEIGT, frisch);
    expect(zeilen[0].titel).toBe('RTW 1 (aufgelöst)');
    expect(wartend).toEqual({ neu: 0, entfallen: 0, umsortiert: false });
  });

  it('alles zugleich: neu, entfallen und umsortiert', () => {
    const gezeigt = [zeile('einheit:1', 'A'), zeile('einheit:2', 'B'), zeile('einheit:3', 'C')];
    const frisch = [zeile('einheit:4', 'D'), zeile('einheit:3', 'C'), zeile('einheit:1', 'A')];
    const { zeilen, wartend } = schleuseZeilen(gezeigt, frisch);
    expect(schluessel(zeilen)).toEqual(['einheit:1', 'einheit:2', 'einheit:3']);
    expect(zeilen[1].entfallen).toBe(true);
    expect(wartend).toEqual({ neu: 1, entfallen: 1, umsortiert: true });
  });
});

describe('schleusenText (LLH-1604)', () => {
  it('ohne Wartendes kein Text', () => {
    expect(schleusenText({ neu: 0, entfallen: 0, umsortiert: false })).toBeNull();
  });

  it('Einzahl und Mehrzahl, verbunden mit Mittelpunkt', () => {
    expect(schleusenText({ neu: 1, entfallen: 0, umsortiert: false })).toBe('1 neuer Posten');
    expect(schleusenText({ neu: 2, entfallen: 0, umsortiert: false })).toBe('2 neue Posten');
    expect(schleusenText({ neu: 0, entfallen: 1, umsortiert: false })).toBe('1 Posten entfallen');
    expect(schleusenText({ neu: 0, entfallen: 3, umsortiert: false })).toBe('3 Posten entfallen');
    expect(schleusenText({ neu: 0, entfallen: 0, umsortiert: true })).toBe('Reihenfolge geändert');
    expect(schleusenText({ neu: 1, entfallen: 1, umsortiert: true })).toBe(
      '1 neuer Posten · 1 Posten entfallen · Reihenfolge geändert',
    );
  });
});

describe('schleusenKurz (LLH-1604)', () => {
  it('die Zahl der neuen gewinnt, sonst das Wort der Änderung', () => {
    expect(schleusenKurz({ neu: 2, entfallen: 1, umsortiert: true })).toBe('2 neu');
    expect(schleusenKurz({ neu: 0, entfallen: 0, umsortiert: true })).toBe('umgeordnet');
    expect(schleusenKurz({ neu: 0, entfallen: 1, umsortiert: false })).toBe('1 entfallen');
    expect(schleusenKurz({ neu: 0, entfallen: 1, umsortiert: true })).toBe('1 entfallen');
  });
});
