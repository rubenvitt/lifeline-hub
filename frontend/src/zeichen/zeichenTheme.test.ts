import { describe, expect, it } from 'vitest';
import { contrastSurface, paintColor } from '@einsatzzeichen/core';
import { kontrast } from '../test/farbmass';
import { farbenDunkel } from '../theme/tokens';
import { ZEICHEN_THEME_DUNKEL, zeichenTheme } from './zeichenTheme';

/**
 * Dunkle Grundlagen, auf denen ein Zeichen im Nachtbetrieb steht, als Literale (sonst prüfte der
 * Test die Palette gegen sich selbst): Grund und hellster Flächenton der Nachtkarte
 * (`pages/lagekarte/basemapStil.ts`, `FARBEN.dark.hintergrund`/`gebaeude`), dazu das Paneel des
 * Inspectors.
 */
const DUNKLER_GRUND = ['#0f1115', '#23262b', farbenDunkel.paneel] as const;

// LLH-1141: nachts zeichnet die Bibliothek das Zeichen selbst hell (Render-Theme `dark`, ESZ-119):
// eine weiße Hinterlegung entlang jeder Tinte, Kopfmarken und Fahrwerk weiß, Körperfarben nach
// DV 102 unverändert. Am Tag bleibt es bei der Referenzpalette wie bisher.
describe('zeichenTheme (LLH-1141)', () => {
  it('nimmt nachts das Theme `dark` der Bibliothek, am Tag keins (Referenzpalette)', () => {
    expect(zeichenTheme(true)).toBe(ZEICHEN_THEME_DUNKEL);
    expect(ZEICHEN_THEME_DUNKEL.id).toBe('dark');
    expect(zeichenTheme(false)).toBeUndefined();
  });

  it('trägt eine Hinterlegung, keine Farbumkehr: schwarze Kontur bleibt schwarz', () => {
    expect(ZEICHEN_THEME_DUNKEL.halo?.widthMm).toBeGreaterThan(0);
    expect(paintColor(ZEICHEN_THEME_DUNKEL, 'schwarz', 'body')).toBe(
      ZEICHEN_THEME_DUNKEL.palette.schwarz,
    );
  });

  it('hält Kontur gegen Hinterlegung und Hinterlegung gegen jeden dunklen Grund ≥ 3 : 1', () => {
    const hinterlegung = contrastSurface(ZEICHEN_THEME_DUNKEL);
    expect(kontrast(ZEICHEN_THEME_DUNKEL.palette.schwarz, hinterlegung)).toBeGreaterThanOrEqual(3);
    for (const grund of DUNKLER_GRUND) {
      expect(kontrast(hinterlegung, grund), `Hinterlegung auf ${grund}`).toBeGreaterThanOrEqual(3);
    }
  });
});
