import { describe, expect, it } from 'vitest';
import { GPUInitializationError } from 'maplibre-gl';
import { isGrafikFehler, KARTE_NICHT_DARSTELLBAR, wennDarstellbar } from './kartenGrafik';

describe('isGrafikFehler (LLH-1353)', () => {
  it('erkennt den Wurf des Kartenkonstruktors ohne WebGL2', () => {
    expect(isGrafikFehler(new GPUInitializationError({}, null))).toBe(true);
  });

  it('nimmt jeden anderen Fehler nicht als fehlende Grafik', () => {
    expect(isGrafikFehler(new TypeError('x is undefined'))).toBe(false);
    expect(isGrafikFehler(new Error('WebGL2 is required'))).toBe(false);
    expect(isGrafikFehler({ name: 'GPUInitializationError' })).toBe(false);
    expect(isGrafikFehler(null)).toBe(false);
  });

  it('der Zustand nennt keine Technik', () => {
    expect(KARTE_NICHT_DARSTELLBAR).toBe('Karte auf diesem Gerät nicht darstellbar');
    expect(KARTE_NICHT_DARSTELLBAR).not.toMatch(/webgl|grafik|treiber|browser/i);
  });
});

describe('wennDarstellbar (LLH-1353)', () => {
  it('liefert die Karte, ohne Grafik null, jeden anderen Wurf weiter', () => {
    expect(wennDarstellbar(() => 'karte')).toBe('karte');
    expect(
      wennDarstellbar(() => {
        throw new GPUInitializationError({}, null);
      }),
    ).toBeNull();
    expect(() =>
      wennDarstellbar(() => {
        throw new TypeError('kaputt');
      }),
    ).toThrow('kaputt');
  });
});
