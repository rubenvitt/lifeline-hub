import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Kein Zoom wie in einer App (LLH-1328, `frontend/AGENTS.md`, Bedien-Leitlinie): iOS zoomt beim
 * Fokus in jedes Feld unter 16 px Schrift, die Dichte-Stufen liegen darunter. Den Zoom sperren
 * Viewport (`index.html`) und `touch-action` (`index.css`) gemeinsam; fällt eins weg, zoomt das
 * Handy wieder beim Tippen oder beim Doppeltipp.
 */
describe('kein Zoom auf dem Handy', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

  it('der Viewport erlaubt keinen Zoom über 1', () => {
    const inhalt = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
    const teile = inhalt.split(',').map((t) => t.trim());
    expect(teile).toContain('width=device-width');
    expect(teile).toContain('initial-scale=1.0');
    expect(teile).toContain('maximum-scale=1.0');
    expect(teile).toContain('user-scalable=no');
  });

  it('das Dokument sperrt den Doppeltipp-Zoom', () => {
    const regel = /(?:^|\n)html\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(regel).toMatch(/touch-action:\s*manipulation;/);
    expect(regel).toMatch(/(?:^|\s)text-size-adjust:\s*100%;/);
  });
});
