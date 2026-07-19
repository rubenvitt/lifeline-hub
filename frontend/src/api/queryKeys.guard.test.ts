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
  // `modulOverrides` (F27/LFH-269): camelCase-Voraltschreibweise, ersetzt durch
  // `einsatzKeys.modulOverrides` mit dem Wert 'einsatz-modul-overrides'. Ohne diesen Eintrag
  // wäre ein Rückfall auf das alte Literal für Guard (a) unsichtbar — der kennt nur die
  // Strings, die IN EINSATZ_KEYS stehen, und das tut 'modulOverrides' nach der Umbenennung
  // gerade nicht mehr.
  const SCHATTEN_PREFIXE = new Set(['einheiten', 'abschnitte', 'mitglieder', 'modulOverrides']);

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

/**
 * Guard (d, LFH-262/F13): das `befehl`-Wire-Event ist live angebunden.
 *
 * Das Backend publiziert seit LFH-64 ein `befehl`-Wire-Event (Anlegen/Ändern/Freigeben/
 * Fortschreiben), das FE hat es aber ignoriert — Befehle (zentrales Führungsartefakt)
 * aktualisierten im Mehrbenutzerbetrieb nicht live. Dieser Test pinnt die Anbindung.
 */
describe('queryKeys-Guard (d): befehl-Wire-Event ist live (LFH-262/F13)', () => {
  it('befehl-Event invalidiert Befehls-Liste und -Detail', () => {
    expect(EINSATZ_STREAM_EVENTS).toHaveProperty('befehl');
    expect(EINSATZ_STREAM_EVENTS.befehl).toEqual([EINSATZ_KEYS.befehle, EINSATZ_KEYS.befehl]);
  });

  it('befehle/befehl sind nicht mehr NICHT_LIVE', () => {
    expect(NICHT_LIVE_KEYS as readonly string[]).not.toContain(EINSATZ_KEYS.befehle);
    expect(NICHT_LIVE_KEYS as readonly string[]).not.toContain(EINSATZ_KEYS.befehl);
  });
});

/**
 * Guard (e, F27/LFH-269): org-scoped Keys dürfen nicht in zwei Schreibweisen existieren.
 *
 * Anlass ist ein realer Split-Cache-Bug: `ladeOrgModulEinstellungen` hing an
 * `['orgModulEinstellungen']` (EinsatzEinstellungenPage) UND an `['org-modul-einstellungen']`
 * (EinsatzDefaults). Zwei Cache-Einträge für denselben Datensatz — die Mutation invalidierte
 * nur ihre eigene Hälfte, die Einsatz-Einstellungsseite zeigte danach stale Rollen-Defaults.
 *
 * Kanonisch ist die kebab-Schreibweise (entspricht dem Endpoint /api/org-modul-einstellungen).
 *
 * GRENZE dieses Guards, bewusst: er verbietet EIN bekanntes Literal, nicht die Bug-KLASSE
 * („derselbe Loader hängt an zwei Keys"). Ein allgemeiner Guard dafür braucht den TS-AST —
 * ein zeilenbasiertes „queryKey in der Nähe von queryFn"-Heuristik produziert zu viele
 * Fehlalarme (Probe: 9 von 37 Loadern falsch-positiv, weil benachbarte useQuery-Blöcke
 * ineinanderlaufen). Der AST-Umbau ist eigener Scope (F27 Arbeitspaket 3).
 * Org-scoped Keys haben zudem bis heute keine Registry — siehe Folgetask.
 */
describe('queryKeys-Guard (e): keine Doppel-Schreibweise org-scoped Keys (F27)', () => {
  // Verbotenes Literal → kanonische Schreibweise.
  const VERBOTEN = new Map([['orgModulEinstellungen', 'org-modul-einstellungen']]);

  it('findet keine camelCase-Variante eines org-scoped Query-Keys', () => {
    const verstoesse: string[] = [];
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      if (pfad.endsWith('/api/queryKeys.ts')) continue; // Home des Registry
      if (/\.test\.tsx?$/.test(pfad)) continue;
      inhalt.split('\n').forEach((zeile, i) => {
        if (istKommentarzeile(zeile)) return;
        const treffer = zeile.match(/\[\s*'([^']+)'/g) ?? [];
        for (const t of treffer) {
          const prefix = /\[\s*'([^']+)'/.exec(t)?.[1];
          const kanonisch = prefix && VERBOTEN.get(prefix);
          if (kanonisch) {
            verstoesse.push(`${pfad}:${i + 1}  '${prefix}' → '${kanonisch}'`);
          }
        }
      });
    }
    expect(
      verstoesse,
      `Doppel-Schreibweise eines org-scoped Query-Keys gefunden (Split-Cache: derselbe Loader landet in zwei Cache-Namespaces, die Invalidierung trifft nur eine Hälfte):\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });
});
