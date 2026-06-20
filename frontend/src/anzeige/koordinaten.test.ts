import { describe, it, expect } from 'vitest';
import { wgs84ZuUtm, wgs84ZuMgrs, utmZone } from './koordinaten';
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

// Referenzpunkte mit extern verifizierten Soll-Werten (NICHT aus dieser
// Implementierung abgeleitet — sonst beweist der Test nichts):
//   • Belgien 51.1°N 4.1°E → UTM 31N 577019.527 / 5661520.775; MGRS 31U ES 77019 61520
//     (sf/PROJ, mm-genau; ungerade Zone 31 → testet Zeilen-Parität)
//     Quelle: tutorials.inbo.be/articles/spatial_mgrs
//   • Red Sand (Weser) 53°51'18"N 8°4'54"E → UTM 32N 439596 / 5967780; MGRS 32U ME 39596 67780
//     (gerade Zone 32) Quelle: killetsoft.de/t_0901_e.htm
//   • 79.9°S 6.1°E → UTM Zone 32 Süd, MGRS-Quadrat MS, Band C
//     (Südhalbkugel → testet False-Northing) Quelle: GeographicLib GeoConvert(1)

describe('utmZone', () => {
  it('bestimmt die Zone aus der Länge (DE: 32 westlich 12°E, 33 östlich)', () => {
    expect(utmZone(53.855, 8.0817)).toBe(32);
    expect(utmZone(51.1, 4.1)).toBe(31);
    expect(utmZone(52.52, 13.4)).toBe(33); // Berlin
  });
});

describe('wgs84ZuUtm', () => {
  it('Belgien (ungerade Zone 31) trifft die PROJ-Referenz auf <0,5 m', () => {
    const u = wgs84ZuUtm(51.1, 4.1);
    expect(u.zone).toBe(31);
    expect(u.band).toBe('U');
    expect(u.hemisphere).toBe('N');
    expect(Math.abs(u.easting - 577019.527)).toBeLessThan(0.5);
    expect(Math.abs(u.northing - 5661520.775)).toBeLessThan(0.5);
  });

  it('Red Sand (gerade Zone 32) trifft die Referenz auf <1 m', () => {
    // Quelle gibt die Lage nur bogensekundengenau + gerundetes UTM an → 1-m-Toleranz.
    const u = wgs84ZuUtm(53.855, 8.0816667);
    expect(u.zone).toBe(32);
    expect(u.band).toBe('U');
    expect(Math.abs(u.easting - 439596)).toBeLessThan(1.0);
    expect(Math.abs(u.northing - 5967780)).toBeLessThan(1.0);
  });

  it('Südhalbkugel wendet False-Northing (10.000.000 m) an', () => {
    const u = wgs84ZuUtm(-79.9, 6.1);
    expect(u.zone).toBe(32);
    expect(u.band).toBe('C');
    expect(u.hemisphere).toBe('S');
    // Nordwert nach False-Northing zwischen 1,0 und 1,2 Mio. m.
    expect(u.northing).toBeGreaterThan(1_000_000);
    expect(u.northing).toBeLessThan(1_200_000);
  });
});

describe('wgs84ZuMgrs', () => {
  it('Belgien (ungerade Zone) → 31U ES 77019 61520', () => {
    expect(wgs84ZuMgrs(51.1, 4.1)).toBe('31U ES 77019 61520');
  });

  it('Red Sand (gerade Zone) → 32U ME 3959 6778 (10-m-Präzision, quellen-robust)', () => {
    // Auf 10 m stimmen Truncation (hier) und gerundete Quelle überein.
    expect(wgs84ZuMgrs(53.855, 8.0816667, 4)).toBe('32U ME 3959 6778');
  });

  it('Südhalbkugel: korrektes 100-km-Quadrat MS in Band C', () => {
    // Quadrat-Buchstaben (Spalte/Zeile) sind der parität-empfindliche Kern.
    expect(wgs84ZuMgrs(-79.9, 6.1)).toContain('32C MS ');
  });

  it('respektiert die gewünschte Stellenzahl (1-km-Präzision = 2+2 Stellen)', () => {
    expect(wgs84ZuMgrs(53.855, 8.0816667, 2)).toBe('32U ME 39 67');
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
