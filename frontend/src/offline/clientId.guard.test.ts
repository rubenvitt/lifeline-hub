import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';

/**
 * Guard (LFH-762): `crypto.randomUUID` steht nur in `offline/clientId.ts`.
 *
 * `randomUUID` ist `[SecureContext]`. Wer den Server im Einsatz-LAN über Klartext-HTTP
 * erreicht, hat es nicht, und ein direkter Aufruf wirft — in der Schnellerfassung schon beim
 * Rendern. `neueClientId()` fällt dort auf `getRandomValues` zurück. Das e2e läuft auf
 * `127.0.0.1` (sicherer Kontext) und sieht den Fall nie, deshalb pinnt ihn der Quelltext.
 *
 * Gesucht wird das Wort `randomUUID` in Code ohne Kommentare, damit auch
 * `crypto['randomUUID']` und `const { randomUUID } = crypto` auffallen. Tests sind
 * ausgenommen, sie stellen den fehlenden Kontext gerade über diesen Namen nach.
 */

const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const HEIM = '/src/offline/clientId.ts';

export function randomUuidStellen(quellen: Record<string, string>): string[] {
  const stellen: string[] = [];
  for (const [pfad, inhalt] of Object.entries(quellen)) {
    if (pfad === HEIM) continue;
    if (/\.test\.tsx?$/.test(pfad) || pfad.startsWith('/src/test/')) continue;
    ohneKommentare(inhalt).forEach((zeile, i) => {
      if (/\brandomUUID\b/.test(zeile)) stellen.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
    });
  }
  return stellen;
}

describe('clientId-Guard (LFH-762): kein crypto.randomUUID außerhalb von neueClientId', () => {
  it('findet keinen direkten Aufruf', () => {
    // Sicherung gegen ein kaputtes Glob-Muster: ein leerer Scan wäre still grün.
    expect(Object.keys(dateien).length).toBeGreaterThan(100);
    expect(dateien[HEIM], 'der Helfer liegt, wo der Guard ihn erwartet').toContain('randomUUID');

    const stellen = randomUuidStellen(dateien);
    expect(
      stellen,
      `crypto.randomUUID fehlt ohne sicheren Kontext (Klartext-HTTP im LAN) und wirft. ` +
        `Bitte neueClientId() aus offline/clientId.ts nehmen:\n${stellen.join('\n')}`,
    ).toEqual([]);
  });

  it('erkennt Aufruf, Indexzugriff und Destrukturierung, aber keinen Kommentar (Selbst-Beweis)', () => {
    expect(
      randomUuidStellen({
        '/src/a/aufruf.ts': 'const id = crypto.randomUUID();',
        '/src/a/index.ts': "const id = crypto['randomUUID']();",
        '/src/a/destrukturiert.ts': 'const { randomUUID } = crypto;',
        '/src/a/kommentar.ts': '// früher crypto.randomUUID()\n/* randomUUID */ const x = 1;',
        '/src/a/aufruf.test.ts': 'crypto.randomUUID();',
        [HEIM]: 'crypto.randomUUID();',
      }),
    ).toEqual([
      '/src/a/aufruf.ts:1  const id = crypto.randomUUID();',
      "/src/a/index.ts:1  const id = crypto['randomUUID']();",
      '/src/a/destrukturiert.ts:1  const { randomUUID } = crypto;',
    ]);
  });
});
