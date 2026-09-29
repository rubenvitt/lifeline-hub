import { describe, expect, it } from 'vitest';
import { flaechenKennung, flaechenwahlEintragStil } from './flaechenwahl';
import type { Flaechenziel } from './klickziel';

type M = {
  id?: string | number;
  layer: { id: string };
  properties: Record<string, unknown> | null;
  geometry: { type: string };
};

const ziel = (
  art: Flaechenziel<M>['art'],
  layer: string,
  properties: Record<string, unknown>,
): Flaechenziel<M> => ({
  art,
  merkmal: { layer: { id: layer }, properties, geometry: { type: 'Polygon' } },
});

describe('flaechenKennung (LFH-812)', () => {
  it('Zone mit Bezeichnung: Typ und Bezeichnung', () => {
    expect(
      flaechenKennung(ziel('zone', 'zonen-fill', { id: 3, label: 'Nord', typ: 'absperrbereich' })),
    ).toEqual({ art: 'Absperrbereich', titel: 'Nord', text: 'Absperrbereich: Nord' });
  });

  it('Zone ohne Bezeichnung: der Typ allein', () => {
    expect(
      flaechenKennung(ziel('zone', 'zonen-line', { id: 3, label: '', typ: 'absperrgrenze' })),
    ).toEqual({ art: 'Absperrgrenze', titel: null, text: 'Absperrgrenze' });
  });

  it('Zone ohne Typ: „Zone"', () => {
    expect(flaechenKennung(ziel('zone', 'zonen-fill', { id: 3, label: 'X' })).text).toBe('Zone: X');
  });

  it('Abschnitt', () => {
    expect(
      flaechenKennung(ziel('abschnitt', 'abschnitte-fill', { id: 9, label: 'EA 2 Süd' })),
    ).toEqual({ art: 'Abschnitt', titel: 'EA 2 Süd', text: 'Abschnitt: EA 2 Süd' });
  });

  it('DWD-Warnung: Name der Ebene und Ereignis', () => {
    expect(
      flaechenKennung(ziel('fachebene', 'fachebene-dwd-fill', { EVENT: 'STURMBÖEN' })).text,
    ).toBe('Wetterwarnungen (DWD): Sturmböen');
  });

  it('NINA-Warnung: die Überschrift unterscheidet zwei Meldungen', () => {
    expect(
      flaechenKennung(ziel('fachebene', 'fachebene-nina-fill', { HEADLINE: 'Bombenfund Altstadt' }))
        .text,
    ).toBe('Amtliche Warnungen (NINA): Bombenfund Altstadt');
    expect(flaechenKennung(ziel('fachebene', 'fachebene-nina-fill', {})).text).toBe(
      'Amtliche Warnungen (NINA): Amtliche Warnung',
    );
  });

  it('Fachebene ohne eigenen Titel: der Name der Ebene allein', () => {
    expect(flaechenKennung(ziel('fachebene', 'fachebene-kritis-fill', {})).text).toBe(
      'KRITIS / sensible Objekte',
    );
  });

  it('keine Datenbank-id und kein Emoji im Text', () => {
    for (const k of [
      flaechenKennung(ziel('zone', 'zonen-fill', { id: 4711, label: '', typ: 'sperrgebiet' })),
      flaechenKennung(ziel('abschnitt', 'abschnitte-fill', { id: 4711, label: '' })),
      flaechenKennung(ziel('fachebene', 'fachebene-dwd-fill', { EVENT: 'GEWITTER' })),
    ]) {
      expect(k.text).not.toContain('4711');
      expect(k.text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('flaechenwahlEintragStil', () => {
  const token = (controlHeight: number) => ({ controlHeight, paddingXS: 8, paddingSM: 12 });

  it('hält die Steuerhöhe jeder Dichtestufe als Boden', () => {
    expect(flaechenwahlEintragStil(token(30)).minHeight).toBeGreaterThanOrEqual(30);
    expect(flaechenwahlEintragStil(token(48)).minHeight).toBeGreaterThanOrEqual(48);
    expect(flaechenwahlEintragStil(token(72)).minHeight).toBeGreaterThanOrEqual(72);
  });

  it('zentriert den Text senkrecht', () => {
    expect(flaechenwahlEintragStil(token(48))).toMatchObject({
      display: 'flex',
      alignItems: 'center',
    });
  });
});
