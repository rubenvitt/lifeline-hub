import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Zoom frei (LLH-2043, `frontend/AGENTS.md`, Bedien-Leitlinie; umgekehrt 22.11.2026 gegenüber
 * LLH-1328 „Kein Zoom wie in einer App“): der Viewport sperrt den Zoom nicht mehr, wer schlecht
 * liest, zieht die Seite größer. `touch-action: manipulation` sperrt weiter nur den Doppeltipp,
 * und den Fokus-Zoom von iOS verhindert die Touch-Feldschrift in `rollen.css`.
 */
describe('Zoom frei (LLH-2043)', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

  it('der Viewport sperrt den Zoom nicht', () => {
    const inhalt = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
    const teile = inhalt.split(',').map((t) => t.trim());
    expect(teile).toContain('width=device-width');
    expect(teile).toContain('initial-scale=1.0');
    expect(teile.filter((t) => /^(maximum-scale|user-scalable)\b/.test(t))).toEqual([]);
  });

  it('das Dokument sperrt nur den Doppeltipp-Zoom', () => {
    const regel = /(?:^|\n)html\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(regel).toMatch(/touch-action:\s*manipulation;/);
    expect(regel).toMatch(/(?:^|\s)text-size-adjust:\s*100%;/);
  });
});
