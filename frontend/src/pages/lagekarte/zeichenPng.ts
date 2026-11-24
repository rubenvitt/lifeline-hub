/**
 * Ein taktisches Zeichen als PNG für das KMZ (Zunder A, Entwurf
 * `docs/superpowers/specs/2026-11-24-k9tkgrou-lagekarte-geo-export-design.md`, „Zeichen als PNG“).
 *
 * `renderCanvas` ohne Theme: wie die Karte am Tag, nie das dunkle Theme und nie selbst
 * eingefärbt (`pages/lagekarte/AGENTS.md`). Vorher muss die Zeichenschrift geladen sein (README von
 * `@einsatzzeichen/core`, „Schrift“), sonst sitzen die Kürzel falsch. Braucht ein echtes Canvas,
 * deshalb nicht in jsdom-Tests; `packKmz` nimmt den Renderer als Parameter.
 */
import {
  renderCanvas,
  rasterDimensionsForWidth,
  TEXT_FONT_FAMILY_ATTR,
} from '@einsatzzeichen/core';
import type { Drawing } from '@einsatzzeichen/schema';

export async function renderZeichenPng(drawing: Drawing, groesse = 64): Promise<Blob> {
  await document.fonts.load(`500 16px ${TEXT_FONT_FAMILY_ATTR}`);
  const { widthPx, heightPx } = rasterDimensionsForWidth(drawing.viewBox, groesse);
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas nicht verfügbar');
  renderCanvas(drawing, ctx, { size: widthPx });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Zeichen ließ sich nicht als PNG ausgeben')),
      'image/png',
    );
  });
}
