import { describe, expect, it } from 'vitest';
import { EINSATZ_KEYS, EINSATZ_STREAM_EVENTS, NICHT_LIVE_KEYS } from './queryKeys';

/**
 * Guard (LFH-122): erzwingt, dass das queryKeys-Registry die EINE Quelle für
 * einsatz-scoped Query-Keys bleibt und die Live-Anbindung explizit ist.
 *
 * (a) Kein Inline-Array-Literal mit einem managed Prefix außerhalb von `queryKeys.ts`
 *     — jede Query nutzt `einsatzKeys.*`. Verhindert, dass eine neue Query still am
 *     Registry (und damit am SSE-Fan-out) vorbeigebaut wird.
 * (b) Jeder managed Key ist GENAU einmal klassifiziert: entweder live (invalidiert
 *     durch ein Wire-Event in EINSATZ_STREAM_EVENTS) oder bewusst NICHT_LIVE.
 */

const MANAGED = new Set<string>(Object.values(EINSATZ_KEYS));

// Alle Quelldateien als Rohtext (Vite): Prefix-Scan der Call-Sites.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function istKommentarzeile(zeile: string): boolean {
  const t = zeile.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

describe('queryKeys-Guard (a): keine Inline-managed-Keys außerhalb des Registry', () => {
  it('findet keinen einsatz-scoped Query-Key als Inline-String-Literal', () => {
    const verstoesse: string[] = [];
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      if (pfad.endsWith('/api/queryKeys.ts')) continue; // Home des Registry
      if (/\.test\.tsx?$/.test(pfad)) continue; // Tests pinnen Wire-Strings bewusst
      inhalt.split('\n').forEach((zeile, i) => {
        if (istKommentarzeile(zeile)) return;
        const treffer = zeile.match(/\[\s*'([^']+)'/g) ?? [];
        for (const t of treffer) {
          const prefix = /\[\s*'([^']+)'/.exec(t)?.[1];
          if (prefix && MANAGED.has(prefix)) {
            verstoesse.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
          }
        }
      });
    }
    expect(
      verstoesse,
      `Inline managed Query-Keys gefunden — bitte einsatzKeys.* nutzen:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });
});

describe('queryKeys-Guard (b): jeder managed Key ist live ODER bewusst nicht-live', () => {
  const liveKeys = new Set<string>(Object.values(EINSATZ_STREAM_EVENTS).flat());
  const nichtLive = new Set<string>(NICHT_LIVE_KEYS);

  it('klassifiziert jeden EINSATZ_KEYS-Prefix genau einmal (XOR live/nicht-live)', () => {
    for (const key of Object.values(EINSATZ_KEYS)) {
      const istLive = liveKeys.has(key);
      const istNichtLive = nichtLive.has(key);
      expect(
        istLive !== istNichtLive,
        `${key}: muss GENAU eines von {live via EINSATZ_STREAM_EVENTS, NICHT_LIVE_KEYS} sein ` +
          `(live=${istLive}, nicht-live=${istNichtLive})`,
      ).toBe(true);
    }
  });

  it('enthält keine NICHT_LIVE_KEYS-Leiche (jeder Eintrag ist ein bekannter EINSATZ_KEY)', () => {
    const bekannt = new Set<string>(Object.values(EINSATZ_KEYS));
    for (const key of nichtLive) {
      expect(bekannt, `NICHT_LIVE_KEYS enthält unbekannten Key ${key}`).toContain(key);
    }
  });
});

/**
 * Guard (c, LFH-215): kein bare-Prefix-Schatten eines managed einsatz-scoped Keys.
 *
 * Einige einsatz-scoped Queries trugen historisch einen bare-Prefix (`['einheiten', …]` statt
 * `einsatzKeys.einheiten(…)` = `['einsatz-einheiten', …]`). Der bare-Prefix steht NICHT in
 * EINSATZ_KEYS → Guard (a) sieht ihn nicht, der SSE-Fan-out invalidiert ihn nicht → die Liste
 * war nicht live und teilte sich den Cache-Namespace nicht mit den `einsatz-*`-Pendants. Dieser
 * Guard verbietet die bekannten Schatten-Prefixe als Inline-Array-Literal, damit die
 * Vereinheitlichung nicht still zurückfällt.
 */
describe('queryKeys-Guard (c): kein bare-Prefix-Schatten managed Keys (LFH-215)', () => {
  // Bare-Prefixe, die denselben Datensatz wie ein `einsatz-*`-Key laden (→ einsatzKeys.* nutzen).
  const SCHATTEN_PREFIXE = new Set(['einheiten', 'abschnitte', 'mitglieder']);

  it('findet keinen bare-Prefix-Query-Key als Inline-String-Literal', () => {
    const verstoesse: string[] = [];
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      if (pfad.endsWith('/api/queryKeys.ts')) continue; // Home des Registry
      if (/\.test\.tsx?$/.test(pfad)) continue; // Tests pinnen Wire-Strings / nutzen bracket-Zugriff
      inhalt.split('\n').forEach((zeile, i) => {
        if (istKommentarzeile(zeile)) return;
        const treffer = zeile.match(/\[\s*'([^']+)'/g) ?? [];
        for (const t of treffer) {
          const prefix = /\[\s*'([^']+)'/.exec(t)?.[1];
          if (prefix && SCHATTEN_PREFIXE.has(prefix)) {
            verstoesse.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
          }
        }
      });
    }
    expect(
      verstoesse,
      `Bare-Prefix-Query-Keys gefunden — bitte einsatzKeys.* nutzen (managed: guard-abgedeckt + SSE-live, sofern der Key nicht bewusst NICHT_LIVE ist wie mitglieder):\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });
});
