import type { CSSProperties } from 'react';
import type { AbBreitePunkt } from '../components/useViewport';

/**
 * Spalten des Kachelrasters der Stab-Seite (LLH-1124, `openspec/changes/archive/2026-10-13-o5nxgqbl-stab-uebersicht/
 * design.md`, D1): eine unter `md`, zwei ab `md`, drei ab `xl`. Feste Stufen statt `auto-fit`, damit
 * S1–S3 ab `xl` sicher eine Reihe bilden. Rein.
 */
export function stabSpalten(abBreite: (punkt: AbBreitePunkt) => boolean): 1 | 2 | 3 {
  if (abBreite('xl')) return 3;
  if (abBreite('md')) return 2;
  return 1;
}

/** Stil des Kachelrasters. `minmax(0, 1fr)`: eine lange Zeile kürzt, statt das Raster zu sprengen. */
export function stabRasterStil(spalten: number, abstand: number): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${spalten}, minmax(0, 1fr))`,
    gap: abstand,
    alignItems: 'stretch',
  };
}
