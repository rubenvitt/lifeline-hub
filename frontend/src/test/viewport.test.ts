import { describe, expect, it } from 'vitest';
import {
  VIEWPORT_STANDARD,
  baueMatchMedia,
  erfassteQueries,
  sendeZeigerAenderung,
  setzeViewportBreite,
  setzeZeigerGrob,
} from './viewport';

/**
 * Testet den global installierten matchMedia-Stub: Nicht-Breiten-Abfragen bleiben falsch
 * (sonst kippt die Theme-Weiche), das Ergebnisobjekt trägt alle sieben Bauteile
 * (`ThemeModeProvider` meldet sich darauf an und ab) und eine gesetzte Breite leckt nicht in
 * den nächsten Test.
 */

describe('matchMedia-Stub (LFH-329 · H24)', () => {
  it('matchMedia-Stub: (min-width: 992px) ist bei 390 px falsch und bei 1024 px wahr', () => {
    const abfrage = baueMatchMedia();

    setzeViewportBreite(1024);
    expect(abfrage('(min-width: 992px)').matches).toBe(true);
    expect(abfrage('(min-width: 1200px)').matches).toBe(false);
    expect(abfrage('(max-width: 575px)').matches).toBe(false);

    setzeViewportBreite(390);
    expect(abfrage('(min-width: 992px)').matches).toBe(false);
    expect(abfrage('(min-width: 1200px)').matches).toBe(false);
    expect(abfrage('(max-width: 575px)').matches).toBe(true);
  });

  it('matchMedia-Stub: wertet die Dezimalschwelle 991.98px aus, nicht bloß Ganzzahlen', () => {
    // antds Abfragen nutzen gebrochene Schwellen; ein Integer-Parser läge bei genau 991 px falsch.
    const abfrage = baueMatchMedia();

    setzeViewportBreite(900);
    expect(abfrage('(max-width: 991.98px)').matches).toBe(true);

    setzeViewportBreite(1024);
    expect(abfrage('(max-width: 991.98px)').matches).toBe(false);
  });

  it('matchMedia-Stub: prefers-color-scheme, prefers-reduced-motion und pointer bleiben unberührt falsch', () => {
    const abfrage = baueMatchMedia();

    setzeViewportBreite(390);
    expect(abfrage('(prefers-color-scheme: dark)').matches).toBe(false);
    expect(abfrage('(prefers-reduced-motion: reduce)').matches).toBe(false);
    expect(abfrage('(pointer: coarse)').matches).toBe(false);

    setzeZeigerGrob(true);
    expect(abfrage('(pointer: coarse)').matches).toBe(true);
    expect(abfrage('(prefers-color-scheme: dark)').matches).toBe(false);
  });

  it('matchMedia-Stub: das Ergebnis trägt alle sieben Bauteile einer Medienabfrage', () => {
    const treffer = baueMatchMedia()('(min-width: 768px)');

    expect(treffer.media).toBe('(min-width: 768px)');
    expect(treffer.onchange).toBeNull();
    for (const bauteil of [
      'addListener',
      'removeListener',
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
    ] as const) {
      expect(typeof treffer[bauteil], `${bauteil} fehlt am Stub-Ergebnis`).toBe('function');
    }
  });

  it('matchMedia-Stub: ein change-Listener wird wirklich gespeichert und beim Abhängen entfernt', () => {
    const abfrage = baueMatchMedia();
    const treffer = abfrage('(pointer: coarse)');
    const gesehen: boolean[] = [];
    const hoerer = (e: MediaQueryListEvent) => gesehen.push(e.matches);

    treffer.addEventListener('change', hoerer);
    sendeZeigerAenderung(true);
    expect(gesehen).toEqual([true]);

    treffer.removeEventListener('change', hoerer);
    sendeZeigerAenderung(false);
    expect(gesehen).toEqual([true]);
  });

  it('matchMedia-Stub: die abgefragten Medienabfragen werden mitgeschrieben', () => {
    const abfrage = baueMatchMedia();
    abfrage('(min-width: 768px)');
    abfrage('(pointer: coarse)');

    expect(erfassteQueries()).toContain('(min-width: 768px)');
    expect(erfassteQueries()).toContain('(pointer: coarse)');
    expect(erfassteQueries()).not.toContain('(any-pointer: coarse)');
  });

  it('matchMedia-Stub: global installiert, Default ist die Fükw-Breite', () => {
    // Ohne Zutun ist der Stub breit (1024 ≥ lg 992 ≥ md 768), die Layout-Suiten kippen nicht in
    // den Schmal-Zweig.
    expect(VIEWPORT_STANDARD).toBe(1024);
    expect(window.matchMedia('(min-width: 992px)').matches).toBe(true);
    expect(window.matchMedia('(min-width: 768px)').matches).toBe(true);
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(false);
  });

  it('matchMedia-Stub: die gesetzte Breite leckt nicht in den nächsten Test (Teil 1: schmal)', () => {
    setzeViewportBreite(390);
    setzeZeigerGrob(true);
    expect(window.matchMedia('(min-width: 768px)').matches).toBe(false);
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(true);
  });

  it('matchMedia-Stub: die gesetzte Breite leckt nicht in den nächsten Test (Teil 2: wieder breit)', () => {
    // Ohne den Reset im globalen afterEach stünde hier noch die 390 aus Teil 1 —
    // `vi.restoreAllMocks()` holt einen per `defineProperty` gesetzten Stub nicht zurück.
    expect(window.matchMedia('(min-width: 768px)').matches).toBe(true);
    expect(window.matchMedia('(min-width: 992px)').matches).toBe(true);
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(false);
  });
});
