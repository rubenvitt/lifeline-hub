import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Der Zoom ist frei (LLH-1774, Spec `schriftskala`, „Die Ansicht lässt sich vergrößern“;
 * umgekehrt 15.11.2026 gegenüber LLH-1328 „Kein Zoom wie in einer App“). Die Begründung „Größe
 * trägt die Dichte“ hielt der Messung nicht stand, und eine Zoom-Sperre verstößt gegen WCAG
 * 1.4.4. Den iOS-Fokus-Zoom fängt die Schrift selbst ab: in `komfortabel` misst ein Feld
 * 14 × 1,15 = 16,1 px. Gesperrt bleibt nur der Doppeltipp (`touch-action: manipulation`), der
 * sonst jeden schnellen Doppelklick auf einen Knopf zum Zoom machte.
 */
describe('Zoom frei, Doppeltipp gesperrt', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

  it('der Viewport sperrt den Zoom nicht', () => {
    const inhalt = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
    const teile = inhalt.split(',').map((t) => t.trim());
    expect(teile).toContain('width=device-width');
    expect(teile).toContain('initial-scale=1.0');
    expect(teile.filter((t) => /^(maximum-scale|user-scalable)=/.test(t))).toEqual([]);
  });

  it('das Dokument sperrt nur den Doppeltipp-Zoom', () => {
    const regel = /(?:^|\n)html\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(regel).toMatch(/touch-action:\s*manipulation;/);
    expect(regel).toMatch(/(?:^|\s)text-size-adjust:\s*100%;/);
  });
});
