/**
 * Schreibwege-Guard (LFH-387): jede schreibende Anfrage läuft über `api/client.ts`.
 *
 * Nur `apiSend`/`apiUpload` tragen den Kopf `X-Erwarteter-Benutzer-Id`, mit dem der Server einen
 * veralteten Tab abweist, dessen Sitzung inzwischen einem anderen Benutzer gehört. Ein
 * handgebautes `fetch(…, { method: 'POST' })` an anderer Stelle schriebe still unter der fremden
 * Sitzung — die Lücke, die LFH-387 schließt. Rohes `fetch` bleibt für LESENDE Sonderfälle erlaubt
 * (Blob-Download in `kartenbilder.ts`, Sitzungsprobe in `useEinsatzLiveStream.ts`).
 *
 * Die Regeln sind deshalb streng, damit eine Methode nicht an einer Variable vorbeikommt:
 *   • `fetch` außerhalb des Clients trägt kein `method` und als zweites Argument höchstens ein
 *     Objekt-LITERAL (`fetch(url, opts)` könnte eine Methode verstecken);
 *   • kein `new Request(` — ein Request-Objekt trüge seine Methode an `fetch` vorbei;
 *   • kein `XMLHttpRequest`, kein `navigator.sendBeacon`;
 *   • kein antd-`<Upload action=…>` (sendet intern per XHR) und kein natives `<form method=…>`
 *     mit schreibender Methode.
 * Was er NICHT sieht: einen solchen Weg in einer Abhängigkeit oder im Service Worker.
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

/** Text des zweiten Arguments eines Aufrufs (ohne Klammern), oder `''`. Kennt verschachtelte
 *  Klammern und Zeichenketten, damit ein Komma darin nicht als Trenner zählt. */
function zweitesArgument(aufruf: string): string {
  let tiefe = 0;
  let zeichenkette: string | null = null;
  for (let i = 1; i < aufruf.length - 1; i++) {
    const z = aufruf[i];
    if (zeichenkette) {
      if (z === '\\') i++;
      else if (z === zeichenkette) zeichenkette = null;
    } else if (z === "'" || z === '"' || z === '`') zeichenkette = z;
    else if ('([{'.includes(z)) tiefe++;
    else if (')]}'.includes(z)) tiefe--;
    else if (z === ',' && tiefe === 0) return aufruf.slice(i + 1, -1).trim();
  }
  return '';
}

/** Block- und ganze Zeilenkommentare durch Leerzeilen ersetzen (Zeilennummern bleiben stehen).
 *  Nur ganze Kommentarzeilen, damit ein `//` in einer URL-Zeichenkette unberührt bleibt. */
function ohneKommentare(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (kommentar) => kommentar.replace(/[^\n]/g, ''))
    .replace(/^\s*\/\/.*$/gm, '');
}

export function befunde(quellen: Record<string, string>): string[] {
  const funde: string[] = [];
  for (const [pfad, roh] of Object.entries(quellen)) {
    if (istAusgeschlossen(pfad)) continue;
    const text = ohneKommentare(roh);
    const zeileBei = (index: number) => text.slice(0, index).split('\n').length;
    if (/\bXMLHttpRequest\b/.test(text)) funde.push(`${pfad}: XMLHttpRequest`);
    if (/\bsendBeacon\s*\(/.test(text)) funde.push(`${pfad}: sendBeacon`);
    if (/\bnew\s+Request\s*\(/.test(text)) funde.push(`${pfad}: new Request`);
    for (const t of text.matchAll(/<Upload\b[^>]*?\baction\s*=/g)) {
      funde.push(`${pfad}:${zeileBei(t.index)}: Upload mit action`);
    }
    for (const t of text.matchAll(
      /<form\b[^>]*?\bmethod\s*=\s*\{?\s*["'`](post|put|patch|delete)/gi,
    )) {
      funde.push(`${pfad}:${zeileBei(t.index)}: form mit schreibender Methode`);
    }
    // `fetch(` als eigener Bezeichner — `refetch(` und `obj.fetch(` zählen nicht.
    for (const treffer of text.matchAll(/(?<![\w.$])fetch\s*\(/g)) {
      const klammer = treffer.index + treffer[0].length - 1;
      const aufruf = text.slice(klammer, aufrufEnde(text, klammer));
      const optionen = zweitesArgument(aufruf);
      if (/\bmethod\b/.test(aufruf)) {
        funde.push(
          `${pfad}:${zeileBei(treffer.index)}: fetch mit method außerhalb von api/client.ts`,
        );
      } else if (optionen !== '' && !optionen.startsWith('{')) {
        funde.push(`${pfad}:${zeileBei(treffer.index)}: fetch mit nicht-literalen Optionen`);
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
      '/src/x/request.ts': `await fetch(new Request('/api/x', anfrage));`,
      '/src/x/opts.ts': `await fetch('/api/x', optionen);`,
      '/src/x/upload.tsx': `<Upload name="datei" action="/api/x" />`,
      '/src/x/form.tsx': `<form className="f" method="post" action="/api/x" />`,
    };
    expect(befunde(quellen)).toEqual([
      '/src/x/boese.ts:2: fetch mit method außerhalb von api/client.ts',
      '/src/x/beacon.ts: sendBeacon',
      '/src/x/xhr.ts: XMLHttpRequest',
      '/src/x/request.ts: new Request',
      '/src/x/opts.ts:1: fetch mit nicht-literalen Optionen',
      '/src/x/upload.tsx:1: Upload mit action',
      '/src/x/form.tsx:1: form mit schreibender Methode',
    ]);
  });

  it('Gegenprobe: lesendes fetch, refetch und api/client.ts sind frei', () => {
    const quellen = {
      '/src/x/lesen.ts': `await fetch('/api/auth/me', { credentials: 'same-origin' });`,
      '/src/x/lesen2.ts': `await fetch(pfad(1, 'a,b'), { signal: AbortSignal.timeout(5) });`,
      '/src/x/nur-url.ts': `await fetch(url);`,
      '/src/x/upload.tsx': `<Upload beforeUpload={() => false} />`,
      '/src/x/form.tsx': `<form onSubmit={x}>`,
      '/src/x/kommentar.ts': `/**\n * maplibre fetcht über \`new Request(url)\`\n */\n// fetch(url, opts)\nconst u = 'http://x';`,
      '/src/x/query.ts': `void query.refetch({ method: 'x' });`,
      '/src/api/client.ts': `await fetch(p, { method: 'POST' });`,
      '/src/x/y.test.ts': `await fetch(p, { method: 'POST' });`,
    };
    expect(befunde(quellen)).toEqual([]);
  });
});
