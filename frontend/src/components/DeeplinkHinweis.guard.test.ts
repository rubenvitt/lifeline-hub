/**
 * Deeplink-Hinweis-Wächter (LLH-1827, Change `a12ms7g9-seitenzustaende`, D5; `frontend/AGENTS.md`,
 * „Deeplink-Muster“, „Ein Objekt, das es nicht (mehr) gibt“).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Ein Parameter-Deeplink auf ein Objekt, das es nicht gibt, verschwand früher still. Jede Seite,
 * die `useQueryParamSelektion` aufruft, zeichnet deshalb die zurückgegebene Lage über ihrer Liste
 * (`DeeplinkHinweis`). Ein neuer Aufrufer ohne Leiste fiele in das stille Verschwinden zurück.
 *
 * ── Was er zählt ────────────────────────────────────────────────────────────────
 * Jede Quelldatei (ohne Tests) mit einem Aufruf `useQueryParamSelektion(` trägt auch
 * `<DeeplinkHinweis` und übernimmt die Rückgabe des Hooks (`= useQueryParamSelektion(`).
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────────
 *   • ob die `anwenden`-Closure an der richtigen Stelle `false` liefert (das belegt der Test der
 *     Seite „unbekannte Kennung zeigt den Hinweis“);
 *   • einen Aufrufer, der die Lage an eine andere Datei weiterreicht.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = 'routing/useQueryParamSelektion.ts';

function lieseQuellen(verzeichnis: string, praefix = ''): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    const name = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, name));
    } else if (/\.tsx?$/.test(eintrag.name) && !/\.test\.tsx?$/.test(eintrag.name)) {
      treffer[name] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

describe('DeeplinkHinweis-Wächter (LLH-1827)', () => {
  const quellen = lieseQuellen(SRC);
  const aufrufer = Object.entries(quellen).filter(
    ([pfad, text]) => pfad !== HOOK && /\buseQueryParamSelektion\(/.test(text),
  );

  it('findet die Aufrufer (Gegenprobe gegen einen leeren Scan)', () => {
    expect(aufrufer.length).toBeGreaterThanOrEqual(13);
  });

  it('jeder Aufrufer übernimmt die Lage und zeichnet den Hinweis', () => {
    const ohne = aufrufer
      .filter(
        ([, text]) =>
          !/=\s*useQueryParamSelektion\(/.test(text) || !text.includes('<DeeplinkHinweis'),
      )
      .map(([pfad]) => pfad);
    expect(ohne).toEqual([]);
  });
});
