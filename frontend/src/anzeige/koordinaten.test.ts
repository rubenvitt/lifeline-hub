import { describe, it, expect } from 'vitest';
import { formatiere, parse, KoordinatenParseFehler } from './koordinaten';

describe('formatiere/parse — WGS84 dezimal', () => {
  it('formatiert byte-exakt mit 5 Nachkommastellen', () => {
    expect(formatiere(51.5, 10.25, 'wgs84')).toBe('51.50000, 10.25000');
  });
  it('parst und ist round-trip-stabil', () => {
    const p = parse('51.50000, 10.25000', 'wgs84');
    expect(p.lat).toBeCloseTo(51.5, 5);
    expect(p.lon).toBeCloseTo(10.25, 5);
  });
  it('wirft KoordinatenParseFehler bei Müll', () => {
    expect(() => parse('kein wert', 'wgs84')).toThrow(KoordinatenParseFehler);
  });
  it('wirft bei out-of-range', () => {
    expect(() => parse('123, 10', 'wgs84')).toThrow(KoordinatenParseFehler);
  });
});

describe('formatiere/parse — DMS', () => {
  it('formatiert mit Hemisphären-Suffix, 3-stelliger Länge', () => {
    expect(formatiere(51.5, 10.25, 'dms')).toBe('51°30\'00"N 010°15\'00"E');
  });
  it('formatiert Süd/West negativ als S/W', () => {
    expect(formatiere(-1.5, -0.25, 'dms')).toBe('01°30\'00"S 000°15\'00"W');
  });
  it('round-trip', () => {
    const p = parse('51°30\'00"N 010°15\'00"E', 'dms');
    expect(p.lat).toBeCloseTo(51.5, 4);
    expect(p.lon).toBeCloseTo(10.25, 4);
  });
  it('wirft bei Müll', () => {
    expect(() => parse('51 nord', 'dms')).toThrow(KoordinatenParseFehler);
  });
});

describe('formatiere/parse — UTM', () => {
  it('formatiert Zone+Band+Easting/Northing (Mitte DE = Zone 32 U)', () => {
    const s = formatiere(51.16, 10.45, 'utm');
    expect(s).toMatch(/^32U \d{6} \d{7}$/);
  });
  it('wählt Zone 33 für Berlin (lon 13.4)', () => {
    expect(formatiere(52.52, 13.4, 'utm')).toMatch(/^33U /);
  });
  it('round-trip (< 1 m ≈ 1e-4 Grad)', () => {
    const s = formatiere(51.16, 10.45, 'utm');
    const p = parse(s, 'utm');
    expect(p.lat).toBeCloseTo(51.16, 4);
    expect(p.lon).toBeCloseTo(10.45, 4);
  });
  it('wirft bei Müll', () => {
    expect(() => parse('garnix', 'utm')).toThrow(KoordinatenParseFehler);
  });
});

describe('formatiere/parse — MGRS', () => {
  it('formatiert lesbar gruppiert GZD + Quadrat + 5+5 Stellen', () => {
    expect(formatiere(51.16, 10.45, 'mgrs')).toMatch(/^\d{1,2}[C-X] [A-Z]{2} \d{5} \d{5}$/);
  });
  it('round-trip via Zellzentrum (< 1 m)', () => {
    const s = formatiere(51.16, 10.45, 'mgrs');
    const p = parse(s, 'mgrs');
    expect(p.lat).toBeCloseTo(51.16, 3);
    expect(p.lon).toBeCloseTo(10.45, 3);
  });
  it('parst auch ohne Leerzeichen', () => {
    const kompakt = formatiere(51.16, 10.45, 'mgrs').replace(/\s+/g, '');
    const p = parse(kompakt, 'mgrs');
    expect(p.lat).toBeCloseTo(51.16, 3);
  });
  it('wirft bei Müll', () => {
    expect(() => parse('XX', 'mgrs')).toThrow(KoordinatenParseFehler);
  });
});

describe('formatiere/parse — Gauß-Krüger', () => {
  it('formatiert Rechts-/Hochwert, Zone 3 für Stuttgart (lon 9.177)', () => {
    const s = formatiere(48.782, 9.177, 'gk');
    expect(s).toMatch(/^R 35\d{5} {2}H 5\d{6}$/); // Rechtswert beginnt mit 3 = Zone 3
  });
  it('round-trip (< 3 m ≈ 1e-4 Grad)', () => {
    const s = formatiere(48.782, 9.177, 'gk');
    const p = parse(s, 'gk');
    expect(p.lat).toBeCloseTo(48.782, 4);
    expect(p.lon).toBeCloseTo(9.177, 4);
  });
  it('wählt Zone 4 für Berlin (Rechtswert beginnt mit 4)', () => {
    expect(formatiere(52.52, 13.4, 'gk')).toMatch(/^R 4/);
  });
  it('wirft bei Müll', () => {
    expect(() => parse('R abc H def', 'gk')).toThrow(KoordinatenParseFehler);
  });
});

describe('formatiere — Fallback-Schutz bei out-of-range', () => {
  it('GK Zone 1 (Belgien, lon 4.1) wirft nicht, gibt WGS84-Dezimal zurück', () => {
    // gkZone(4.1) = Math.round(4.1/3) = 1 → EPSG:31465 nicht registriert → proj4 würde werfen
    expect(() => formatiere(51.1, 4.1, 'gk')).not.toThrow();
    expect(formatiere(51.1, 4.1, 'gk')).toBe('51.10000, 4.10000');
  });
  it('MGRS bei lat > 84°N wirft nicht, gibt WGS84-Dezimal zurück', () => {
    // mgrs.forward wirft für Breitengrade außerhalb 80S–84N
    expect(() => formatiere(85, 10, 'mgrs')).not.toThrow();
    expect(formatiere(85, 10, 'mgrs')).toBe('85.00000, 10.00000');
  });
  it('gültiger DE-GK-Koordinate (Stuttgart) formatiert weiterhin als GK', () => {
    // Sanity: der Fallback darf den Happy-Path nicht kaputt machen
    expect(formatiere(48.782, 9.177, 'gk')).toMatch(/^R 35\d{5} {2}H 5\d{6}$/);
  });
});
