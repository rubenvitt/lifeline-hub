import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';
import { GERAETESPEICHER, RAEUMSCHRITTE } from './geraetRaeumung';

/**
 * Guard (LFH-767, design.md D1): Jede Datei, die eine IndexedDB öffnet oder in `localStorage`
 * bzw. `sessionStorage` schreibt, steht in `GERAETESPEICHER` mit einer Entscheidung. Ein neuer
 * Speicherort landet so nicht still auf dem Gerät: Er muss geräumt, gebunden oder begründet
 * stehen gelassen werden.
 *
 * Gesucht wird in Code ohne Kommentare. Tests und `src/test/` sind ausgenommen, sie legen
 * Speicher gerade zum Prüfen an. Seit LFH-942 schreibt der Code über `sicherSchreiben` aus
 * `lib/sichererSpeicher`; der Helfer selbst speichert nichts aus eigenem Antrieb und fällt heraus.
 */

const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SCHREIBT =
  /\bopenDB\s*[<(]|\b(?:localStorage|sessionStorage)\s*\??\.\s*setItem\b|\bsicherSchreiben\s*\(/;
const HELFER = '/src/lib/sichererSpeicher.ts';

export function speicherDateien(quellen: Record<string, string>): string[] {
  const treffer: string[] = [];
  for (const [pfad, inhalt] of Object.entries(quellen)) {
    if (/\.test\.tsx?$/.test(pfad) || pfad.startsWith('/src/test/') || pfad === HELFER) continue;
    if (ohneKommentare(inhalt).some((zeile) => SCHREIBT.test(zeile))) treffer.push(pfad);
  }
  return treffer.sort();
}

describe('Gerätespeicher-Guard (LFH-767): jeder Speicherort hat eine Entscheidung', () => {
  it('kennt jede Datei, die auf dem Gerät speichert', () => {
    // Sicherung gegen ein kaputtes Glob-Muster: ein leerer Scan wäre still grün.
    expect(Object.keys(dateien).length).toBeGreaterThan(100);

    const verzeichnet = new Set(GERAETESPEICHER.map((e) => `/src/${e.datei}`));
    const fehlend = speicherDateien(dateien).filter((pfad) => !verzeichnet.has(pfad));
    expect(
      fehlend,
      `Diese Dateien speichern auf dem Gerät, stehen aber nicht in GERAETESPEICHER ` +
        `(offline/geraetRaeumung.ts). Bitte mit Entscheidung und Grund eintragen:\n` +
        fehlend.join('\n'),
    ).toEqual([]);
  });

  it('verzeichnet keine Datei, die es nicht (mehr) gibt oder die nichts speichert', () => {
    const gefunden = new Set(speicherDateien(dateien));
    const veraltet = GERAETESPEICHER.map((e) => `/src/${e.datei}`).filter((p) => !gefunden.has(p));
    expect(veraltet).toEqual([]);
  });

  it('begründet jede Entscheidung', () => {
    for (const eintrag of GERAETESPEICHER) {
      expect(eintrag.grund.trim().length, `${eintrag.ort}: Grund fehlt`).toBeGreaterThan(20);
    }
  });

  it('erkennt openDB, setItem mit und ohne ?. und sicherSchreiben, aber keinen Kommentar (Selbst-Beweis)', () => {
    expect(
      speicherDateien({
        '/src/a/idb.ts': "const d = openDB<X>('x', 1);",
        '/src/a/lokal.ts': "window.localStorage.setItem('k', 'v');",
        '/src/a/sitzung.ts': "globalThis.sessionStorage?.setItem('k', 'v');",
        '/src/a/helfer.ts': "sicherSchreiben('k', 'v');",
        '/src/a/nurLesen.ts': "sicherLesen('k');",
        [HELFER]: "globalThis.localStorage.setItem('k', 'v');",
        '/src/a/kommentar.ts': "// localStorage.setItem('k', 'v')\n/* openDB('x') */",
        '/src/a/test.test.ts': "localStorage.setItem('k', 'v');",
      }),
    ).toEqual(['/src/a/helfer.ts', '/src/a/idb.ts', '/src/a/lokal.ts', '/src/a/sitzung.ts']);
  });
});

/**
 * Guard (LLH-2012): Was jeder Ausgang räumt, liegt in genau einem der beiden Räumschritte, auf der
 * Platte oder im Tab. Eine unterbrochene Sitzung (LLH-1770) räumt sofort nur die Platte, den Tab
 * erst mit der Frist; ein Ort ohne Schritt bliebe beim Sitzungsende liegen, ein Ort im falschen
 * Schritt ginge zu früh oder zu spät.
 */
describe('Räumschritte (LLH-2012): PLATTE und TAB decken jeden Ausgang ab', () => {
  const jederAusgang = GERAETESPEICHER.filter((e) => e.entscheidung === 'jeder-ausgang');
  /** Im Tab, aber kein Speicherort: Inhalte im Arbeitsspeicher (LLH-1737). */
  const NUR_ARBEITSSPEICHER = ['verlaufInhalt'];

  it('nennt für jeden Ort „jeder-ausgang“ einen Schritt, der in genau einer Menge liegt', () => {
    for (const e of jederAusgang) {
      expect(e.schritt, `${e.ort}: Schritt fehlt`).toBeTruthy();
      const inPlatte = RAEUMSCHRITTE.platte.includes(e.schritt ?? '');
      const imTab = RAEUMSCHRITTE.tab.includes(e.schritt ?? '');
      expect(Number(inPlatte) + Number(imTab), `${e.ort}: ${e.schritt}`).toBe(1);
    }
  });

  it('ordnet sessionStorage dem Tab zu, IndexedDB und localStorage der Platte', () => {
    for (const e of jederAusgang) {
      const erwartet = e.ort.startsWith('sessionStorage')
        ? RAEUMSCHRITTE.tab
        : RAEUMSCHRITTE.platte;
      expect(erwartet, `${e.ort}: ${e.schritt} im falschen Schritt`).toContain(e.schritt);
    }
  });

  it('räumt in keinem Schritt einen Ort, der nicht verzeichnet ist', () => {
    const genannt = new Set(jederAusgang.map((e) => e.schritt));
    expect(RAEUMSCHRITTE.platte.filter((s) => !genannt.has(s))).toEqual([]);
    expect(
      RAEUMSCHRITTE.tab.filter((s) => !genannt.has(s) && !NUR_ARBEITSSPEICHER.includes(s)),
    ).toEqual([]);
  });

  it('gibt Schritte nur Orten, die jeder Ausgang räumt', () => {
    const andere = GERAETESPEICHER.filter((e) => e.entscheidung !== 'jeder-ausgang' && e.schritt);
    expect(andere.map((e) => e.ort)).toEqual([]);
  });
});
