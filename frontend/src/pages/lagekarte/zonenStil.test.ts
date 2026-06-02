import { describe, expect, it } from 'vitest';
import { zoneStil, ZONE_TYPEN } from './zonenStil';

describe('zoneStil', () => {
  it('leitet roten Stil für gefahrengebiet ab (gespeicherte Farbe wird ignoriert)', () => {
    const s = zoneStil('gefahrengebiet', '#abcdef');
    expect(s.fillColor).toBe('#cf1322');
    expect(s.lineColor).toBe('#cf1322');
    expect(s.fillOpacity).toBeGreaterThan(0);
  });

  it('absperrgrenze ist eine kräftige Linie ohne Füllung', () => {
    const s = zoneStil('absperrgrenze', null);
    expect(s.fillOpacity).toBe(0);
    expect(s.lineWidth).toBeGreaterThanOrEqual(3);
  });

  it('freie_skizze nutzt die gespeicherte Farbe (Fallback bei leer)', () => {
    expect(zoneStil('freie_skizze', '#00ff00').fillColor).toBe('#00ff00');
    expect(zoneStil('freie_skizze', null).fillColor).toBe('#1677ff');
  });

  it('Katalog: nur freie_skizze erlaubt beide Geometrien', () => {
    const freie = ZONE_TYPEN.find((t) => t.typ === 'freie_skizze')!;
    expect(freie.geometrie).toBe('beides');
    expect(ZONE_TYPEN.find((t) => t.typ === 'absperrgrenze')!.geometrie).toBe('LineString');
    expect(ZONE_TYPEN.find((t) => t.typ === 'gefahrengebiet')!.geometrie).toBe('Polygon');
  });
});
