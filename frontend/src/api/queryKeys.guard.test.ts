import { describe, expect, it } from 'vitest';
import { EINSATZ_KEYS, EINSATZ_STREAM_EVENTS, NICHT_LIVE_KEYS } from './queryKeys';
import { ENGE_ARTEN, scanneQueryKeys, type Fund } from './queryKeyScan';

/**
 * Guard (LFH-122): erzwingt, dass das queryKeys-Registry die EINE Quelle für
 * einsatz-scoped Query-Keys bleibt und die Live-Anbindung explizit ist.
 *
 * (a) Kein Inline-Array-Literal mit einem managed oder Schatten-Prefix außerhalb von
 *     `queryKeys.ts` — jede Query nutzt `einsatzKeys.*`. Verhindert, dass eine neue Query still
 *     am Registry (und damit am SSE-Fan-out) vorbeigebaut wird.
 * (b) Jeder managed Key ist GENAU einmal klassifiziert: entweder live (invalidiert
 *     durch ein Wire-Event in EINSATZ_STREAM_EVENTS) oder bewusst NICHT_LIVE.
 * (d) Das `befehl`-Wire-Event ist live angebunden.
 * (e) Org-scoped Keys existieren nicht in zwei Schreibweisen.
 * (f) Jeder Inline-Query-Key außerhalb des Registry steht auf der Migrations-Allowlist.
 *
 * ERKENNUNG seit LFH-312: TS-AST statt zeilenlokaler Regex (siehe `queryKeyScan.ts`, dort auch
 * die Radius-Trennung WEIT/ENG). Mehrzeilige Literale sind damit sichtbar, Kommentare erzeugen
 * strukturell keinen Fehlalarm mehr, und der Quote-Stil ist irrelevant. Die
 * `istKommentarzeile`-Heuristik ist ersatzlos entfallen.
 *
 * VERHALTENSGLEICHHEIT der Umstellung wurde GEMESSEN, nicht behauptet: der weitere AST-Radius
 * findet im Bestand exakt dieselbe (leere) Verstoßmenge für (a) und (e) wie die alte Regex.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * WAS DIESER GUARD NICHT SIEHT — bewusste Grenzen, damit die nächste Session nicht raten muss:
 *
 *  1. MEHRSTUFIGE INDIREKTION. Erfasst wird EIN Schritt innerhalb DERSELBEN Datei: ein
 *     Literal, das in einen lokalen Key-Helfer fließt (`inval('einsatz-uhs')`, siehe
 *     `schluessel-helfer-arg` in queryKeyScan.ts). Ein Helfer, der einen Helfer ruft, oder
 *     einer, der über eine Modulgrenze importiert wird, ist unsichtbar. Die Grenze ist
 *     absichtlich hier gezogen (LFH-312): alles darüber ist Datenfluss-Analyse, und im
 *     Bestand existiert genau EIN Key-Helfer (`live/useEinsatzLiveStream.ts`).
 *  2. LAUFZEIT-KOMPOSITION jenseits von Template-Literalen — `[praefix + '-liste', id]` oder
 *     ein aus einer Map gelesener Prefix. Position 0 ist dann kein String-Literal.
 *  3. DIE BUG-KLASSE hinter Guard (e): „derselbe Loader hängt an zwei Keys". Verboten ist ein
 *     bekanntes Literal, nicht das Muster. Löst erst die ORG_KEYS-Registry (LFH-307) ab.
 *  4. OB EIN KEY FACHLICH RICHTIG IST. Der Guard prüft Herkunft und Schreibweise, nicht, ob
 *     der invalidierte Prefix zum geänderten Datenobjekt passt.
 *
 * Ausgeschlossene Dateien (siehe `istAusgeschlossen`) werden GAR NICHT gescannt — ein Verstoß
 * in einer `.test.ts`/`.typetest.ts` ist per Konstruktion unsichtbar, nicht bloß erlaubt.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

const MANAGED = new Set<string>(Object.values(EINSATZ_KEYS));

/**
 * Bare-Prefix-Schatten managed Keys (LFH-215) — bis LFH-312 ein eigener Guard (c).
 *
 * Einige einsatz-scoped Queries trugen historisch einen bare-Prefix (`['einheiten', …]` statt
 * `einsatzKeys.einheiten(…)` = `['einsatz-einheiten', …]`). Der bare-Prefix steht NICHT in
 * EINSATZ_KEYS → ohne diesen Eintrag sieht Guard (a) ihn nicht, der SSE-Fan-out invalidiert ihn
 * nicht → die Liste wäre nicht live und teilte sich den Cache-Namespace nicht mit den
 * `einsatz-*`-Pendants.
 *
 * `modulOverrides` (F27/LFH-269): camelCase-Voraltschreibweise, ersetzt durch
 * `einsatzKeys.modulOverrides` mit dem Wert 'einsatz-modul-overrides'. Ohne diesen Eintrag wäre
 * ein Rückfall auf das alte Literal unsichtbar — Guard (a) kennt nur die Strings, die IN
 * EINSATZ_KEYS stehen, und das tut 'modulOverrides' nach der Umbenennung gerade nicht mehr.
 *
 * Sie stehen bewusst in der Prefix-Menge von Guard (a) (WEITER Radius) und NICHT in der
 * Allowlist von Guard (f): (f) sieht nur den ENGEN Radius, eine Extraktion in eine Konstante
 * (`const K = ['einheiten', id]`) wäre dort unsichtbar.
 */
const SCHATTEN_PREFIXE = ['einheiten', 'abschnitte', 'mitglieder', 'modulOverrides'];

/** Prefix-Menge von Guard (a): managed Keys + ihre bekannten Schatten. */
const VERBOTEN_INLINE = new Set<string>([...MANAGED, ...SCHATTEN_PREFIXE]);

// Alle Quelldateien als Rohtext (Vite). Das Glob bleibt bewusst HIER und nicht im Scanner —
// sonst landete bei einem versehentlichen Produktiv-Import der Quelltext im App-Bundle.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function istAusgeschlossen(pfad: string): boolean {
  if (pfad.endsWith('/api/queryKeys.ts')) return true; // Home des Registry
  if (pfad.endsWith('/api/queryKeyScan.ts')) return true; // hält CACHE_CALLS-Strings in Arrays
  // Tests pinnen Wire-Strings bewusst. `.typetest.ts` (LFH-265) zählt mit: es endet NICHT auf
  // `.test.ts` (vor „test" steht ein „e", kein Punkt) und wäre sonst mitgescannt. Heute
  // folgenlos — Typ-Ebenen-Pins enthalten keine Array-AUSDRÜCKE —, aber ein `as const`-Tupel
  // zum Pinnen eines Key-Typs wäre ein Fehlalarm.
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
 * LEERLAUF-SCHUTZ. Alle Guards unten haben die Form „für jeden Fund gilt …" und wären über
 * einer LEEREN Fundmenge trivial wahr. Ein kaputtes Glob, ein zu breiter Ausschluss oder ein
 * Scanner, der nichts mehr meldet, sähe dann wie ein grüner Lauf aus — genau der stille
 * Durchfall, den dieser Guard verhindern soll.
 */
describe('queryKeys-Guard: der Scan läuft überhaupt', () => {
  it('scannt Dateien und findet die erwartete Größenordnung an Query-Keys', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(200);
    expect(ENGE_FUNDE.length).toBeGreaterThan(50);
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
 * („derselbe Loader hängt an zwei Keys"). Der AST-Umbau (LFH-312) hat die ERKENNUNG präzisiert,
 * nicht diese Grenze aufgehoben — sie löst erst die ORG_KEYS-Registry aus LFH-307 ab, die
 * org-scoped Keys überhaupt erst enumerierbar macht.
 */
describe('queryKeys-Guard (e): keine Doppel-Schreibweise org-scoped Keys (F27)', () => {
  // Verbotenes Literal → kanonische Schreibweise.
  const VERBOTEN = new Map([['orgModulEinstellungen', 'org-modul-einstellungen']]);

  it('findet keine camelCase-Variante eines org-scoped Query-Keys', () => {
    const verstoesse = FUNDE.filter((f) => VERBOTEN.has(f.prefix)).map(
      (f) => `${f.pfad}:${f.zeile}  '${f.prefix}' → '${VERBOTEN.get(f.prefix)}'`,
    );
    expect(
      verstoesse,
      `Doppel-Schreibweise eines org-scoped Query-Keys gefunden (Split-Cache: derselbe Loader landet in zwei Cache-Namespaces, die Invalidierung trifft nur eine Hälfte):\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * Guard (f, LFH-312/AP4): Allowlist statt Denylist für Inline-Query-Keys.
 *
 * Die Guards (a)/(c)/(e) waren DENYLISTS — sie verbieten benannte Literale. Ein NEUER
 * org-scoped Inline-Key (`['neues-modul', …]`) fiel durch jedes Netz, weil ihn niemand
 * vorher aufgeschrieben hatte. Guard (f) dreht die Beweislast um: jeder Inline-Query-Key
 * ist ein Verstoß, es sei denn, er steht unten.
 *
 * DIE ALLOWLIST IST MIGRATIONSSCHULD, KEIN FREIBRIEF. Jeder Eintrag ist ein org-scoped Key
 * ohne Registry — genau das, was LFH-307 (ORG_KEYS + orgKeys-Factory) auflöst. Die Liste
 * schrumpft dort im Lockstep und ist am Ende leer. EIN NEUES PREFIX HINZUZUFÜGEN IST NICHT
 * VORGESEHEN: neue Keys gehören in eine Registry, nicht in diese Liste.
 *
 * Der Seed ist per AST gegen den Stand dieses Branches GEMESSEN (90 enge Fundstellen,
 * 22 distinkte Prefixe), nicht abgeschrieben. Er ist disjunkt zu MANAGED/SCHATTEN/VERBOTEN —
 * ein managed Key kann hier also nicht versehentlich freigekauft werden (Test unten).
 */
const QUERY_KEY_ALLOWLIST: readonly string[] = [
  'admin-karte',
  'auth-provider',
  'benutzer',
  'einheit-typen',
  'einsaetze',
  'etb-bausteine',
  'fachebene',
  'fahrzeug-status',
  'fahrzeug-vorschlaege',
  'fahrzeuge',
  'karte-config',
  'material',
  'material-kategorien',
  'org-einstellungen',
  'org-modul-einstellungen',
  'organisation',
  'personal',
  'personal-status',
  'personal-vorschlaege',
  'qualifikationen',
  'sprechgruppen',
  'stichwort-vorschlaege',
];

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
    // Ein Template-Literal an Position 0 (`[\`einsatz-${modul}\`, id]`) umgeht JEDE Registry
    // und JEDE Allowlist, weil der Prefix erst zur Laufzeit entsteht. Er ist deshalb
    // unbedingt verboten und nicht allowlist-fähig. Bestand: 0 Fundstellen.
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
    // Ohne diesen Test könnte ein späterer „mach den Guard grün"-Reflex einen managed Key
    // in die Allowlist schreiben — Guard (f) wäre zufrieden und die Registry-Pflicht wäre
    // still ausgehebelt. (a) und (f) dürfen sich nicht überlappen.
    const ueberlappung = QUERY_KEY_ALLOWLIST.filter((p) => VERBOTEN_INLINE.has(p));
    expect(ueberlappung).toEqual([]);
  });
});
