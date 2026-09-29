/**
 * Schreibwege-Guard (LFH-387): jede schreibende Anfrage läuft über `api/client.ts`.
 *
 * Nur `apiSend`/`apiUpload` tragen den Kopf `X-Erwarteter-Benutzer-Id`, mit dem der Server einen
 * veralteten Tab abweist, dessen Sitzung inzwischen einem anderen Benutzer gehört. Ein
 * handgebautes `fetch(…, { method: 'POST' })` an anderer Stelle schriebe still unter der fremden
 * Sitzung — die Lücke, die LFH-387 schließt. Rohes `fetch` bleibt für LESENDE Sonderfälle erlaubt
 * (Blob-Download in `kartenbilder.ts`, Sitzungsprobe in `useEinsatzLiveStream.ts`).
 *
 * Was der Guard NICHT sieht: eine Methode, die über eine Variable oder ein gespreiztes
 * Optionsobjekt hereinkommt (`fetch(url, opts)`). Deshalb gilt die Regel streng: ein `fetch`
 * außerhalb des Clients darf gar kein `method` in seinem Aufruf tragen, und `XMLHttpRequest`
 * sowie `navigator.sendBeacon` kommen im Produktcode nicht vor.
 */
import { describe, expect, it } from 'vitest';

// Rohtext über Vite; das Glob bleibt im Test, damit kein Quelltext ins App-Bundle gerät.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function istAusgeschlossen(pfad: string): boolean {
  if (pfad.endsWith('/api/client.ts')) return true; // der eine Schreibweg
  return /\.(type)?test\.tsx?$/.test(pfad) || pfad.includes('/test/');
}

/** Index hinter der schließenden Klammer des Aufrufs, der bei `start` (auf `(`) beginnt. */
function aufrufEnde(text: string, start: number): number {
  let tiefe = 0;
  for (let i = start; i < text.length; i++) {
    const z = text[i];
    if (z === '(') tiefe++;
    else if (z === ')') {
      tiefe--;
      if (tiefe === 0) return i + 1;
    }
  }
  return text.length;
}

export function befunde(quellen: Record<string, string>): string[] {
  const funde: string[] = [];
  for (const [pfad, text] of Object.entries(quellen)) {
    if (istAusgeschlossen(pfad)) continue;
    if (/\bXMLHttpRequest\b/.test(text)) funde.push(`${pfad}: XMLHttpRequest`);
    if (/\bsendBeacon\s*\(/.test(text)) funde.push(`${pfad}: sendBeacon`);
    // `fetch(` als eigener Bezeichner — `refetch(` und `obj.fetch(` zählen nicht.
    for (const treffer of text.matchAll(/(?<![\w.$])fetch\s*\(/g)) {
      const klammer = treffer.index + treffer[0].length - 1;
      const aufruf = text.slice(klammer, aufrufEnde(text, klammer));
      if (/\bmethod\b/.test(aufruf)) {
        const zeile = text.slice(0, treffer.index).split('\n').length;
        funde.push(`${pfad}:${zeile}: fetch mit method außerhalb von api/client.ts`);
      }
    }
  }
  return funde;
}

describe('Schreibwege-Guard (LFH-387)', () => {
  it('kein schreibender Netzaufruf außerhalb von api/client.ts', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(100);
    expect(befunde(dateien)).toEqual([]);
  });

  it('Gegenprobe: erkennt ein eingeschleustes Schreib-fetch, auch mehrzeilig', () => {
    const quellen = {
      '/src/x/boese.ts': `export async function f() {
  await fetch(pfad(1), {
    credentials: 'same-origin',
    method: 'POST',
  });
}`,
      '/src/x/beacon.ts': `navigator.sendBeacon('/api/x', daten);`,
      '/src/x/xhr.ts': `const x = new XMLHttpRequest();`,
    };
    expect(befunde(quellen)).toEqual([
      '/src/x/boese.ts:2: fetch mit method außerhalb von api/client.ts',
      '/src/x/beacon.ts: sendBeacon',
      '/src/x/xhr.ts: XMLHttpRequest',
    ]);
  });

  it('Gegenprobe: lesendes fetch, refetch und api/client.ts sind frei', () => {
    const quellen = {
      '/src/x/lesen.ts': `await fetch('/api/auth/me', { credentials: 'same-origin' });`,
      '/src/x/query.ts': `void query.refetch({ method: 'x' });`,
      '/src/api/client.ts': `await fetch(p, { method: 'POST' });`,
      '/src/x/y.test.ts': `await fetch(p, { method: 'POST' });`,
    };
    expect(befunde(quellen)).toEqual([]);
  });
});
