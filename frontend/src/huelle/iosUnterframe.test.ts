import { describe, expect, it } from 'vitest';
import { starteIosUnterframe } from '../test/huelle';

/**
 * Unterframes der iOS-App bekommen keinen Standort (LLH-2071): sonst fragte WebKit dort selbst
 * nach, an der Brücke und ihrer Regel „nur der aktive Server“ vorbei.
 */
describe('Standort in Unterframes der iOS-Hülle (LLH-2071)', () => {
  it('im Unterframe meldet jede Abfrage Code 1, wie die Web-API später', async () => {
    const fenster: { top?: object } = { top: {} };
    const nav: { geolocation?: Geolocation } = {};
    starteIosUnterframe(fenster, nav);
    const codes: number[] = [];
    nav.geolocation!.getCurrentPosition(
      () => codes.push(0),
      (e) => codes.push(e.code),
    );
    nav.geolocation!.watchPosition(
      () => codes.push(0),
      (e) => codes.push(e.code),
    );
    nav.geolocation!.clearWatch(1);
    expect(codes).toEqual([]);
    await Promise.resolve();
    expect(codes).toEqual([1, 1]);
  });

  it('im Hauptframe tut das Skript nichts', () => {
    const fenster: { top?: object } = {};
    fenster.top = fenster;
    const nav: { geolocation?: Geolocation } = {};
    starteIosUnterframe(fenster, nav);
    expect(nav.geolocation).toBeUndefined();
  });
});
