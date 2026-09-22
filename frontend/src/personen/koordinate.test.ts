import { describe, expect, it } from 'vitest';
import { formatKoordinate, hatKoordinate, koordinatenText, parseKoordinate } from './koordinate';

describe('parseKoordinate', () => {
  it.each([
    ['52.2691/9.1342', 52.2691, 9.1342],
    ['#52.2691/9.1342', 52.2691, 9.1342],
    ['52,2691/9,1342', 52.2691, 9.1342],
    [' 52.2691 / 9.1342 ', 52.2691, 9.1342],
    ['-33.8688/-151.2093', -33.8688, -151.2093],
    ['90/180', 90, 180],
    ['-90/-180', -90, -180],
    ['52/9', 52, 9],
  ])('liest „%s“', (text, lat, lon) => {
    expect(parseKoordinate(text)).toEqual({ ok: true, lat, lon });
  });

  it.each([
    ['', 'Koordinate fehlt'],
    ['#', 'Koordinate fehlt'],
    ['#52.2691', 'trennen'],
    ['52.2691, 9.1342', 'trennen'],
    ['52.1/9.3/1', 'trennen'],
    ['52.1/', 'keine Zahl'],
    ['/9.3', 'keine Zahl'],
    ['abc/9.3', 'keine Zahl'],
    ['52..1/9.3', 'keine Zahl'],
    ['52.1.2/9.3', 'keine Zahl'],
    ['95/9', 'Breite außerhalb'],
    ['-90.5/9', 'Breite außerhalb'],
    ['52/181', 'Länge außerhalb'],
    ['52/-180.1', 'Länge außerhalb'],
  ])('lehnt „%s“ ab', (text, grund) => {
    const e = parseKoordinate(text);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.grund).toContain(grund);
  });
});

describe('formatKoordinate', () => {
  it('schreibt vier Nachkommastellen mit Punkt', () => {
    expect(formatKoordinate(52.2691, 9.1342)).toBe('52.2691/9.1342');
    expect(formatKoordinate(52, -9.5)).toBe('52.0000/-9.5000');
    expect(formatKoordinate(52.269149, 9.13426)).toBe('52.2691/9.1343');
  });

  it('liest die eigene Schreibweise zurück', () => {
    const e = parseKoordinate(formatKoordinate(-33.8688, 151.2093));
    expect(e).toEqual({ ok: true, lat: -33.8688, lon: 151.2093 });
  });
});

describe('hatKoordinate / koordinatenText', () => {
  it('kennt nur das vollständige Paar', () => {
    expect(hatKoordinate({ antreff_lat: 52.2691, antreff_lon: 9.1342 })).toBe(true);
    expect(hatKoordinate({ antreff_lat: 0, antreff_lon: 0 })).toBe(true);
    expect(hatKoordinate({ antreff_lat: 52.2691 })).toBe(false);
    expect(hatKoordinate({ antreff_lat: null, antreff_lon: 9 })).toBe(false);
    expect(koordinatenText({ antreff_lat: 52.2691, antreff_lon: 9.1342 })).toBe('52.2691/9.1342');
    expect(koordinatenText({ antreff_lon: 9.1342 })).toBeNull();
  });
});
