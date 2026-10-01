import { describe, expect, it } from 'vitest';
import {
  EINSATZ_KEYS,
  EINSATZ_STREAM_EVENTS,
  GLOBAL_KEYS,
  NICHT_LIVE_GLOBAL_KEYS,
  NICHT_LIVE_KEYS,
  ORG_STREAM_EVENTS,
} from './queryKeys';
import { ENGE_ARTEN, scanneQueryKeys, type Fund } from './queryKeyScan';

/**
 * Guard (LFH-122): das queryKeys-Registry bleibt die EINE Quelle für Query-Keys, und die
 * Live-Anbindung ist explizit.
 *
 * (a) Kein Inline-Array-Literal mit einem managed oder Schatten-Prefix außerhalb von
 *     `queryKeys.ts`; jede Query nutzt die Factory.
 * (b) Jeder managed Key ist GENAU einmal klassifiziert: live (EINSATZ_STREAM_EVENTS) oder
 *     bewusst NICHT_LIVE.
 * (d) Das `befehl`-Wire-Event ist live angebunden.
 * (g) Jeder globale Key ist GENAU einmal klassifiziert: live (ORG_STREAM_EVENTS, LFH-734) oder
 *     bewusst NICHT_LIVE_GLOBAL_KEYS.
 * (f) Jeder Inline-Query-Key außerhalb des Registry steht auf der Allowlist (die leer ist).
 *
 * Erkennung per TS-AST (`queryKeyScan.ts`, dort auch die Radien WEIT/ENG): mehrzeilige Literale
 * sind sichtbar, Kommentare erzeugen keinen Fehlalarm, der Quote-Stil ist egal.
 *
 * ── WAS DIESER GUARD NICHT SIEHT ──
 *
 *  1. MEHRSTUFIGE INDIREKTION. Erfasst wird EIN Schritt in DERSELBEN Datei: ein Literal, das in
 *     einen lokalen Key-Helfer fließt (`inval('einsatz-uhs')`). Ein Helfer, der einen Helfer
 *     ruft, oder einer über eine Modulgrenze ist unsichtbar.
 *  2. LAUFZEIT-KOMPOSITION jenseits von Template-Literalen (`[praefix + '-liste', id]`, ein aus
 *     einer Map gelesener Prefix).
 *  3. „Derselbe Loader hängt an zwei Keys“ innerhalb der Registry; dafür bräuchte es Wissen
 *     über den `queryFn`.
 *  4. OB EIN KEY FACHLICH RICHTIG IST (passt der invalidierte Prefix zum Datenobjekt?).
 *
 * Ausgeschlossene Dateien (`istAusgeschlossen`) werden GAR NICHT gescannt.
 */

const MANAGED = new Set<string>(Object.values(EINSATZ_KEYS));

/**
 * Bare-Prefix-Schatten managed Keys: frühere Schreibweisen (`['einheiten', …]` statt
 * `['einsatz-einheiten', …]`, camelCase `modulOverrides`), die nicht in EINSATZ_KEYS stehen.
 * Ohne diesen Eintrag sähe Guard (a) einen Rückfall nicht, und der SSE-Fan-out invalidierte
 * ihn nicht. Sie stehen im WEITEN Radius von (a), nicht in der Allowlist von (f): dort wäre die
 * Extraktion in eine Konstante unsichtbar.
 */
const SCHATTEN_PREFIXE = ['einheiten', 'abschnitte', 'mitglieder', 'modulOverrides'];

/** Prefix-Menge von Guard (a): managed Keys + ihre bekannten Schatten. */
const VERBOTEN_INLINE = new Set<string>([...MANAGED, ...SCHATTEN_PREFIXE]);

// Das Glob bleibt bewusst HIER und nicht im Scanner, sonst landete bei einem versehentlichen
// Produktiv-Import der Quelltext im App-Bundle.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function istAusgeschlossen(pfad: string): boolean {
  if (pfad.endsWith('/api/queryKeys.ts')) return true; // Home des Registry
  if (pfad.endsWith('/api/queryKeyScan.ts')) return true; // hält CACHE_CALLS-Strings in Arrays
  // Tests pinnen Wire-Strings bewusst. `.typetest.ts` zählt mit: es endet NICHT auf `.test.ts`.
  return /\.(type)?test\.tsx?$/.test(pfad);
}

/** WEITE Fundmenge: jedes Array-Literal mit String an Position 0 (+ Helfer-Indirektion). */
const FUNDE: Fund[] = Object.entries(dateien)
  .filter(([pfad]) => !istAusgeschlossen(pfad))
  .flatMap(([pfad, inhalt]) => scanneQueryKeys(pfad, inhalt));

/** ENGE Fundmenge: nur echte Query-Key-Kontexte (siehe ENGE_ARTEN). */
const ENGE_FUNDE = FUNDE.filter((f) => ENGE_ARTEN.includes(f.art));

const zeige = (f: Fund): string => `${f.pfad}:${f.zeile}  '${f.prefix}' [${f.art}]`;

/**
 * LEERLAUF-SCHUTZ: alle Guards unten haben die Form „für jeden Fund gilt …“ und wären über einer
 * LEEREN Fundmenge trivial wahr (kaputtes Glob, zu breiter Ausschluss, stummer Scanner).
 */
describe('queryKeys-Guard: der Scan läuft überhaupt', () => {
  it('scannt Dateien und findet Array-Literale', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(200);
    // Untere Schranke auf der WEITEN Menge: die enge ist legitim leer, die weite (gewöhnliche
    // String-Arrays im Code) bleibt dauerhaft gut gefüllt und taugt als Lebendprobe.
    expect(FUNDE.length).toBeGreaterThan(50);
  });

  it('findet nach der LFH-307-Migration KEINEN Inline-Query-Key mehr', () => {
    // Der Zielzustand, positiv formuliert: die enge Menge ist leer.
    expect(ENGE_FUNDE.map(zeige)).toEqual([]);
  });
});

describe('queryKeys-Guard (a): keine Inline-managed-Keys außerhalb des Registry', () => {
  it('findet keinen einsatz-scoped Query-Key (auch nicht als Schatten-Prefix)', () => {
    const verstoesse = FUNDE.filter((f) => VERBOTEN_INLINE.has(f.prefix)).map(zeige);
    expect(
      verstoesse,
      `Inline managed/Schatten-Query-Keys gefunden — bitte einsatzKeys.* nutzen (managed: guard-abgedeckt + SSE-live, sofern der Key nicht bewusst NICHT_LIVE ist wie mitglieder):\n${verstoesse.join('\n')}`,
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

/** Guard (d): das `befehl`-Wire-Event ist live angebunden. */
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

describe('queryKeys-Guard (e): der Einsatzkopf ist live (LFH-555)', () => {
  // Literale, nicht die Factory: der Wire-Name `einsatz` und die zwei Prefixe sind der Vertrag.
  it('einsatz-Event invalidiert den Kopf und die Stab-Anzeige (eine Terminwahrheit, zwei Caches)', () => {
    expect(EINSATZ_STREAM_EVENTS).toHaveProperty('einsatz');
    expect((EINSATZ_STREAM_EVENTS as Record<string, readonly string[]>).einsatz).toEqual([
      'einsatz',
      'einsatz-stab',
    ]);
  });

  it('der Einsatzkopf ist nicht mehr NICHT_LIVE', () => {
    expect(NICHT_LIVE_KEYS as readonly string[]).not.toContain('einsatz');
  });
});

/**
 * Guard (f): Allowlist statt Denylist für Inline-Query-Keys. Jeder Inline-Query-Key ist ein
 * Verstoß, es sei denn, er steht unten. Die Liste ist leer, und ein neues Prefix hinzuzufügen
 * ist NICHT vorgesehen: neue Keys gehören in eine Registry. Sie ist disjunkt zu
 * MANAGED/SCHATTEN/VERBOTEN (Test unten).
 */
const QUERY_KEY_ALLOWLIST: readonly string[] = [];

describe('queryKeys-Guard (f): Inline-Query-Keys nur laut Allowlist (LFH-312)', () => {
  const erlaubt = new Set(QUERY_KEY_ALLOWLIST);

  it('findet kein Inline-Query-Key-Prefix außerhalb der Allowlist', () => {
    const verstoesse = ENGE_FUNDE.filter(
      (f) => f.art !== 'dynamischer-prefix' && !erlaubt.has(f.prefix),
    ).map(zeige);
    expect(
      verstoesse,
      `Nicht erlaubtes Inline-Query-Key-Prefix gefunden. Query-Keys gehören in eine Registry ` +
        `(einsatz-scoped: api/queryKeys.ts; org-scoped: folgt mit LFH-307) — die Allowlist ist ` +
        `Migrationsschuld und nimmt keine neuen Einträge auf:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  it('findet keinen dynamisch zusammengesetzten Prefix', () => {
    // Ein Template-Literal an Position 0 umgeht JEDE Registry und Allowlist, weil der Prefix erst
    // zur Laufzeit entsteht; unbedingt verboten.
    const verstoesse = FUNDE.filter((f) => f.art === 'dynamischer-prefix').map(zeige);
    expect(
      verstoesse,
      `Dynamisch zusammengesetzter Query-Key-Prefix gefunden — er ist für Registry und Guard ` +
        `unsichtbar:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  it('STALE-CHECK: jeder Allowlist-Eintrag hat noch eine Fundstelle', () => {
    const vorhanden = new Set(ENGE_FUNDE.map((f) => f.prefix));
    const leichen = QUERY_KEY_ALLOWLIST.filter((p) => !vorhanden.has(p));
    expect(
      leichen,
      `Allowlist-Leichen: diese Prefixe haben keine Fundstelle mehr und gehören gelöscht ` +
        `(LFH-307 schrumpft die Liste im Lockstep mit der Migration):\n${leichen.join('\n')}`,
    ).toEqual([]);
  });

  it('kauft keinen managed/Schatten-Key frei (Allowlist ∩ Denylist = ∅)', () => {
    // Ein managed Key in der Allowlist hebelte die Registry-Pflicht still aus; (a) und (f) dürfen
    // sich nicht überlappen.
    const ueberlappung = QUERY_KEY_ALLOWLIST.filter((p) => VERBOTEN_INLINE.has(p));
    expect(ueberlappung).toEqual([]);
  });
});

describe('queryKeys-Guard (g): jeder globale Key ist live ODER bewusst nicht-live (LFH-734)', () => {
  const liveKeys = new Set<string>(Object.values(ORG_STREAM_EVENTS).flat());
  const nichtLive = new Set<string>(NICHT_LIVE_GLOBAL_KEYS);

  it('klassifiziert jeden GLOBAL_KEYS-Prefix genau einmal (XOR live/nicht-live)', () => {
    for (const key of Object.values(GLOBAL_KEYS)) {
      const istLive = liveKeys.has(key);
      const istNichtLive = nichtLive.has(key);
      expect(
        istLive !== istNichtLive,
        `${key}: muss GENAU eines von {live via ORG_STREAM_EVENTS, NICHT_LIVE_GLOBAL_KEYS} sein ` +
          `(live=${istLive}, nicht-live=${istNichtLive})`,
      ).toBe(true);
    }
  });

  it('führt in ORG_STREAM_EVENTS nur bekannte globale Keys', () => {
    const bekannt = new Set<string>(Object.values(GLOBAL_KEYS));
    for (const key of [...liveKeys, ...nichtLive]) {
      expect(bekannt, `unbekannter globaler Key ${key}`).toContain(key);
    }
  });
});
