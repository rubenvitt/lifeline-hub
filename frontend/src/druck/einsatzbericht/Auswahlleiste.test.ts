import { describe, expect, it } from 'vitest';
import { haekchenStil, zielAbstand } from './Auswahlleiste';

/** Bedienziele der Auswahlleiste (LFH-902) über die Dichte-Staffel 30 / 48 / 72 px. */
describe('Auswahlleiste – Bedienziele', () => {
  const stufen = [
    { controlHeight: 30, paddingSM: 12, padding: 16 },
    { controlHeight: 48, paddingSM: 12, padding: 16 },
    { controlHeight: 72, paddingSM: 12, padding: 16 },
  ];

  it('jedes Häkchen ist mindestens so hoch wie die Steuerhöhe der Stufe', () => {
    expect(stufen.map((t) => haekchenStil(t).minHeight)).toEqual([30, 48, 72]);
  });

  it('Häkchen stehen in komfortabel ≥ 8 px und in handschuh ≥ 16 px auseinander', () => {
    expect(zielAbstand(stufen[1])).toBeGreaterThanOrEqual(8);
    expect(zielAbstand(stufen[2])).toBeGreaterThanOrEqual(16);
  });
});
