// frontend/src/command-palette/schnellaktionen.guard.test.ts
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { SCHNELLAKTIONEN } from './befehle';
import { modulRegistry, modulZielRoute } from '../einsatz/modulRegistry';
import { einsatzModulPfad } from '../routing/deeplinks';

/**
 * Guard (LFH-391 · A1): die vier Schnellaktionen der Kommandopalette zeigen auf Seiten, die
 * `?neu=1` auch WIRKLICH lesen — und auf ein fertiges Modul der Registry.
 *
 * Warum überhaupt ein Guard: eine Schnellaktion, die ins Leere läuft, macht keinen Test rot
 * und wirft keinen Fehler. Sie navigiert, die Zielseite ignoriert den Parameter, und die
 * Person steht auf einer Liste statt in der Erfassung. Genau das war einmal live — die
 * Unfallhilfsstellen liegen unter `/unfallhilfsstellen/liste`, der bare Modulpfad zeigt auf
 * `UnfallhilfsstellenDefault` (LFH-331 · B3, siehe Doc an der Tabelle in `befehle.ts`).
 *
 * ERKENNUNG: TS-AST, nicht Regex (Muster `api/queryKeyScan.ts`). Gemessen: ein naives Grep
 * auf `neu=1` über die Nicht-Test-Quellen liefert ACHT Dateien mit VIER Fehlalarmen aus
 * Kommentaren und Buildern (`pages/LagekartePage.tsx`, `pages/schaeden/SchadenErfassenModal.tsx`,
 * `command-palette/befehle.ts`, `routing/deeplinks.ts`); das AST-Prädikat findet exakt die vier
 * Leser. Kommentare sind strukturell keine Knoten, der Quote-Stil ist egal, und ein Aufruf über
 * mehrere Zeilen bleibt sichtbar.
 *
 * DIE DECKUNGSAUSSAGE IST EINE ZUORDNUNG, KEIN ZÄHLVERGLEICH. „vier Einträge, vier Leser"
 * wäre zu schwach: eine fünfte Schnellaktion auf ein Modul ganz ohne Leser bliebe grün,
 * sobald irgendeine unbeteiligte Datei ein `searchParams.get('neu')` bekommt. Geprüft wird
 * deshalb je Eintrag, dass es einen Leser SEINES Trägermoduls gibt. Die Zuordnung
 * Leser-Datei → Modul läuft über den DATEINAMEN (`PersonenPage.tsx` → `personen`, verglichen
 * gegen Schlüssel und Route des Registry-Eintrags), nicht über die Routenauflösung.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * WAS DIESER GUARD NICHT SIEHT — bewusste Grenzen, damit die nächste Session nicht raten muss:
 *
 *  1. ER LÖST KEINE ROUTEN AUF. Dass die Datei mit dem Leser tatsächlich unter dem Zielpfad
 *     hängt, ist NICHT geprüft — die UHS-Divergenz `/unfallhilfsstellen/liste` trägt weiterhin
 *     allein der Literal-Pin in `befehle.test.ts` („baut die Schnellaktions-Ziele über die
 *     Deeplink-Registry"). Die Auflösung über `App.tsx` wäre machbar, kostete aber einen
 *     zweiten Scanner samt eigenem Selbstbeweis; sie gehört in die Etappe, die eine fünfte
 *     Zeile tatsächlich anlegt.
 *  2. INDIREKTION — und die ist keine blosse Lücke, sondern eine FALLE. Erfasst wird
 *     `X.get('neu')` / `X.has('neu')` mit dem Schlüssel als LITERAL. Zieht jemand ihn in
 *     eine Konstante (`const NEU = 'neu'; …get(NEU)`) oder hinter einen Helfer
 *     (`useQueryParamSelektion('neu', …)`), verschwindet der Leser nicht still — der Guard
 *     wird ROT und meldet „KEINE Seite dieses Moduls liest ?neu=1", obwohl sie es tut.
 *     Der Deeplink funktioniert dabei unverändert; gemessen an `PersonenPage`.
 *     Der Guard erzwingt damit implizit ein Literal im Produktivcode. Das ist der Preis
 *     dafür, ohne Routenauflösung auszukommen — wer es ändern will, ändert den Scanner,
 *     nicht die Seite: eine Änderung, die den Deeplink nicht anfasst, darf kein Gate brechen.
 *  3. OB DER GEFUNDENE LESER DEN PARAMETER VERWERTET. Ein toter Zweig zählt mit.
 *  4. TESTDATEIEN werden gar nicht gescannt — ein Leser in einer `.test.tsx` ist per
 *     Konstruktion unsichtbar, nicht bloß erlaubt.
 *  5. DIE ZUORDNUNG HÄNGT AM DATEINAMEN. Ein Leser in einer Datei, deren Name keinen
 *     Registry-Eintrag trifft, ist keinem Modul zuordenbar — der Guard meldet das (statt ihn
 *     still zu schlucken), aber er kann die Zugehörigkeit nicht selbst herstellen.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

/** Eine Fundstelle `X.get('neu')` / `X.has('neu')`. */
interface NeuLeser {
  pfad: string;
  /** 1-basiert, wie in Editor-/Guard-Meldungen üblich. */
  zeile: number;
}

/**
 * Findet die Stellen, an denen ein Suchparameter namens `neu` gelesen wird.
 *
 * Prädikat: CallExpression, deren Callee ein PropertyAccess auf `get`/`has` ist und deren
 * erstes Argument das String-Literal `'neu'` ist. Bewusst OHNE Typprüfung des Empfängers —
 * ein `useSearchParams()`-Destructuring aufzulösen bräuchte das Typprogramm; der Preis wäre
 * eine Analyse, deren Fehlerfälle niemand mehr überblickt. Der Selbstbeweis unten misst,
 * was das Prädikat trennt.
 */
export function findeNeuLeser(pfad: string, quelltext: string): NeuLeser[] {
  const quelle = ts.createSourceFile(
    pfad,
    quelltext,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    pfad.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const funde: NeuLeser[] = [];
  const gehe = (knoten: ts.Node): void => {
    if (ts.isCallExpression(knoten) && ts.isPropertyAccessExpression(knoten.expression)) {
      const name = knoten.expression.name.text;
      const erstes = knoten.arguments[0];
      if (
        (name === 'get' || name === 'has') &&
        erstes &&
        ts.isStringLiteralLike(erstes) &&
        erstes.text === 'neu'
      ) {
        funde.push({
          pfad,
          zeile: quelle.getLineAndCharacterOfPosition(knoten.getStart(quelle)).line + 1,
        });
      }
    }
    ts.forEachChild(knoten, gehe);
  };
  gehe(quelle);
  return funde;
}

// Alle Quelldateien als Rohtext (Vite). Das Glob bleibt HIER im Guard und nicht in einer
// Produktivdatei — sonst landete der komplette Quelltext des Frontends im App-Bundle.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `.typetest.ts` zählt mit: es endet NICHT auf `.test.ts` (vor „test" steht ein „e"). */
const istTestdatei = (pfad: string): boolean => /\.(type)?test\.tsx?$/.test(pfad);

const LESER: NeuLeser[] = Object.entries(dateien)
  .filter(([pfad]) => !istTestdatei(pfad))
  .flatMap(([pfad, inhalt]) => findeNeuLeser(pfad, inhalt));

/** Vergleichsform für die Dateiname-↔-Registry-Zuordnung: nur Buchstaben und Ziffern. */
const normal = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Modulschlüssel zu einer Leser-Datei über ihren Dateinamen.
 *
 * `pages/PersonenPage.tsx` → `personenpage` → ohne Endsilbe `personen` → Registry-Eintrag
 * `personen`. Verglichen wird gegen Schlüssel UND Route, weil beide auseinanderfallen können
 * (`gefahrenzonen` hat die Route `gefahren`, und `GefahrenPage.tsx` folgt der Route).
 */
export function modulZuLeserDatei(pfad: string): string[] {
  const basis = normal((pfad.split('/').pop() ?? '').replace(/\.tsx?$/, '')).replace(/page$/, '');
  if (!basis) return [];
  return modulRegistry
    .filter((m) => [m.key, m.route, modulZielRoute(m)].some((s) => normal(s) === basis))
    .map((m) => m.key);
}

const LESER_MODULE = new Map<string, string[]>();
for (const l of LESER) {
  for (const key of modulZuLeserDatei(l.pfad)) {
    LESER_MODULE.set(key, [...(LESER_MODULE.get(key) ?? []), l.pfad]);
  }
}

const zeige = (l: NeuLeser): string => `${l.pfad}:${l.zeile}`;

/**
 * LEERLAUF-SCHUTZ. Die Deckungsaussage unten hat die Form „für jeden Eintrag existiert ein
 * Leser". Über einer leeren Tabelle wäre sie trivial wahr, über einer leeren Fundmenge
 * dagegen trivial falsch — der teure Fall ist ein kaputtes Glob mit gleichzeitig leerer
 * Tabelle. Beide Enden werden deshalb hier festgenagelt.
 */
describe('Schnellaktionen-Guard: der Scan läuft überhaupt', () => {
  it('scannt die Quellen und findet Leser', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(200);
    expect(
      LESER.length,
      'kein einziger `?neu=1`-Leser gefunden — Glob oder Prädikat kaputt',
    ).toBeGreaterThan(0);
    expect(
      SCHNELLAKTIONEN.length,
      'leere Schnellaktions-Tabelle macht jede Aussage unten trivial',
    ).toBeGreaterThan(0);
  });

  /**
   * SELBSTBEWEIS. Ein Guard, der nur per Konstruktion grün ist, sagt nichts aus — und die
   * Trennschärfe gegen den Kommentarfall ist der ganze Grund für den AST: genau daran
   * scheitert das naive Regex (gemessen 8 Dateien statt 4).
   */
  it('findet den echten Aufruf und NICHT Kommentar, Text oder fremden Schlüssel', () => {
    const quelle = `
      // Schnellaktion: ?neu=1 öffnet die Erfassung
      /* auch hier steht searchParams.get('neu') nur als Prosa */
      const a = "neu=1";
      const b = params.get('person');
      const c = params.get("neu");
      const d = suchparameter
        .has('neu');
    `;
    expect(findeNeuLeser('/src/synthetisch.ts', quelle).map((l) => l.zeile)).toEqual([6, 7]);
  });
});

describe('Schnellaktionen-Guard: Trägermodul', () => {
  it('nennt je Eintrag ein FERTIGES Modul der Registry', () => {
    for (const a of SCHNELLAKTIONEN) {
      const m = modulRegistry.find((x) => x.key === a.modulKey);
      expect(
        m,
        `Schnellaktion „${a.label}" nennt das unbekannte Modul '${a.modulKey}'`,
      ).toBeDefined();
      // Spiegel des Freigabefilters in `baueBefehle`: ein unfertiges Trägermodul liefert dort
      // ohnehin keine Schnellaktion, die Zeile wäre also tote Tabelle.
      expect(
        m!.status,
        `Trägermodul '${a.modulKey}' ist nicht 'fertig' — die Zeile kann nie erscheinen`,
      ).toBe('fertig');
    }
  });
});

describe('Schnellaktionen-Guard: Ziel', () => {
  it('liegt unter dem Modulpfad seines EIGENEN Trägers und trägt neu=1', () => {
    const einsatzId = 4711;
    for (const a of SCHNELLAKTIONEN) {
      const m = modulRegistry.find((x) => x.key === a.modulKey)!;
      const basis = einsatzModulPfad(einsatzId, modulZielRoute(m));
      const ziel = a.pfad(einsatzId);
      const [pfadTeil, query = ''] = ziel.split('?');
      expect(
        pfadTeil === basis || pfadTeil.startsWith(`${basis}/`),
        `„${a.label}" zeigt auf ${ziel}, liegt aber nicht unter dem Modulpfad ${basis}`,
      ).toBe(true);
      // Über `URLSearchParams` statt per String-Vergleich: `?q=x&neu=1` und `?neu=1` sind
      // dieselbe Aussage, ein `endsWith('neu=1')` wäre an der Parameterreihenfolge hängen
      // geblieben.
      expect(new URLSearchParams(query).get('neu'), `„${a.label}" (${ziel}) trägt kein neu=1`).toBe(
        '1',
      );
    }
  });
});

describe('Schnellaktionen-Guard: Deckung', () => {
  /**
   * DIE tragende Aussage. Sie ist eine ZUORDNUNG, kein Zählvergleich — siehe Kopfkommentar.
   */
  it('hat je Eintrag eine Seite seines Trägermoduls, die ?neu=1 wirklich liest', () => {
    for (const a of SCHNELLAKTIONEN) {
      expect(
        LESER_MODULE.get(a.modulKey) ?? [],
        `Schnellaktion „${a.label}" zeigt auf das Modul '${a.modulKey}', aber KEINE Seite dieses ` +
          `Moduls liest ?neu=1. Gefundene Leser:\n${LESER.map(zeige).join('\n')}\n` +
          `Zugeordnet: ${[...LESER_MODULE].map(([k, v]) => `${k} ← ${v.join(', ')}`).join(' | ')}`,
      ).not.toHaveLength(0);
    }
  });

  /**
   * Gegenstück zur Zuordnung: sie hängt am Dateinamen, und eine Namensdrift machte die
   * Aussage oben still schwächer (ein Leser zählte dann für gar kein Modul mehr). Die
   * UMKEHRUNG „jeder Leser gehört zu einer Schnellaktion" wird bewusst NICHT behauptet — eine
   * Seite darf `?neu=1` lesen, ohne dass die Palette dafür eine Zeile führt (LFH-506 legt
   * genau solche Leser an, bevor die Zeilen dazukommen).
   */
  it('ordnet jeden gefundenen Leser einem Registry-Modul zu', () => {
    const verwaist = LESER.filter((l) => modulZuLeserDatei(l.pfad).length === 0);
    expect(
      verwaist.map(zeige),
      'Diese Dateien lesen ?neu=1, ihr Name trifft aber keinen Registry-Eintrag — die ' +
        'Deckungsaussage oben kann sie nicht sehen. Datei umbenennen oder die Zuordnung erweitern.',
    ).toEqual([]);
    const mehrdeutig = LESER.filter((l) => modulZuLeserDatei(l.pfad).length > 1);
    expect(mehrdeutig.map(zeige), 'Dateiname trifft mehrere Registry-Einträge').toEqual([]);
  });
});
