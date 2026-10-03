import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { SCHNELLAKTIONEN, type SchnellaktionParameter } from './befehle';
import { modulRegistry, modulZielRoute } from '../einsatz/modulRegistry';
import { einsatzModulPfad, parseZeichnenAuftrag } from '../routing/deeplinks';
import { zeichenAuftragZuEntwurf } from '../pages/lagekarte/zeichenAuftrag';

/**
 * Guard: die Schnellaktionen der Kommandopalette zeigen auf ein fertiges Modul der Registry und
 * auf Seiten, die den Auftrag ihres Ziels WIRKLICH lesen. Eine Schnellaktion ins Leere macht keinen
 * Test rot: die Zielseite ignoriert den Parameter, und die Person steht auf einer Liste statt in
 * der Erfassung.
 *
 * Zwei Aktionsarten, je nach dem Parameter, den der Eintrag deklariert (LFH-825): `neu`
 * (Erfassung, `?neu=1`) und `zeichnen` (Zeichenmodus der Lagekarte, `?zeichnen=<zonentyp>`). Ziel
 * und Deckung werden JE PARAMETER geprüft; ein `neu`-Leser deckt keine Zeichen-Aktion.
 *
 * Erkennung per TS-AST (Muster `api/queryKeyScan.ts`): ein Grep auf `neu=1` träfe auch Kommentare
 * und Builder. Die Deckung ist eine ZUORDNUNG, kein Zählvergleich: je Eintrag muss es einen Leser
 * SEINES Parameters in einer Datei SEINES Trägermoduls geben, zugeordnet über den DATEINAMEN
 * (`PersonenPage.tsx` → `personen`, `LagekartePage.tsx` → `lagekarte`, gegen Schlüssel und Route
 * des Registry-Eintrags).
 *
 * ── WAS DIESER GUARD NICHT SIEHT ──
 *
 *  1. ER LÖST KEINE ROUTEN AUF. Dass die Datei mit dem Leser unter dem Zielpfad hängt, trägt der
 *     Literal-Pin in `befehle.test.ts` (UHS-Listenroute).
 *  2. INDIREKTION, und das ist eine FALLE: erfasst wird `X.get('<parameter>')` /
 *     `X.has('<parameter>')` mit dem Schlüssel als LITERAL. Hinter einer Konstante oder einem Helfer wird der Guard ROT, obwohl
 *     der Deeplink funktioniert. Wer das ändern will, ändert den Scanner, nicht die Seite.
 *  3. OB DER LESER DEN PARAMETER VERWERTET; ein toter Zweig zählt mit.
 *  4. TESTDATEIEN werden gar nicht gescannt.
 *  5. DIE ZUORDNUNG HÄNGT AM DATEINAMEN; ein Leser ohne passenden Registry-Eintrag wird gemeldet,
 *     nicht zugeordnet.
 */

/** Eine Fundstelle `X.get('<parameter>')` / `X.has('<parameter>')`. */
interface Leser {
  pfad: string;
  /** 1-basiert, wie in Editor-/Guard-Meldungen üblich. */
  zeile: number;
}

/**
 * Findet die Stellen, an denen ein Suchparameter namens `parameter` gelesen wird: CallExpression
 * mit PropertyAccess auf `get`/`has` und dem String-Literal `parameter` als erstem Argument. Ohne
 * Typprüfung des Empfängers (das bräuchte das Typprogramm); der Selbstbeweis unten misst, was das
 * Prädikat trennt.
 */
export function findeLeser(pfad: string, quelltext: string, parameter: string): Leser[] {
  const quelle = ts.createSourceFile(
    pfad,
    quelltext,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    pfad.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const funde: Leser[] = [];
  const gehe = (knoten: ts.Node): void => {
    if (ts.isCallExpression(knoten) && ts.isPropertyAccessExpression(knoten.expression)) {
      const name = knoten.expression.name.text;
      const erstes = knoten.arguments[0];
      if (
        (name === 'get' || name === 'has') &&
        erstes &&
        ts.isStringLiteralLike(erstes) &&
        erstes.text === parameter
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

/**
 * Was ein Ziel je Parameter tragen muss. Exhaustiv: eine neue Aktionsart bricht den Typcheck,
 * statt ungeprüft durchzugehen. Die Zeichen-Aktion muss einen Auftrag tragen, den die Lagekarte
 * wirklich in einen Zeichenmodus übersetzt — nicht nur einen syntaktisch gültigen.
 */
const ZIEL_TRAEGT: Record<SchnellaktionParameter, (wert: string | null) => boolean> = {
  neu: (wert) => wert === '1',
  zeichnen: (wert) => {
    const auftrag = parseZeichnenAuftrag(wert);
    return auftrag != null && zeichenAuftragZuEntwurf(auftrag) != null;
  },
};

// Das Glob bleibt HIER im Guard, sonst landete der Quelltext des Frontends im App-Bundle.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `.typetest.ts` zählt mit: es endet NICHT auf `.test.ts`. */
const istTestdatei = (pfad: string): boolean => /\.(type)?test\.tsx?$/.test(pfad);

const QUELLEN = Object.entries(dateien).filter(([pfad]) => !istTestdatei(pfad));

/** Die Parameter, die die Tabelle tatsächlich benutzt — nur für sie gibt es Leser zu prüfen. */
const PARAMETER = [...new Set(SCHNELLAKTIONEN.map((a) => a.parameter))];

const LESER = new Map<SchnellaktionParameter, Leser[]>(
  PARAMETER.map((p) => [p, QUELLEN.flatMap(([pfad, inhalt]) => findeLeser(pfad, inhalt, p))]),
);

/** Vergleichsform für die Dateiname-↔-Registry-Zuordnung: nur Buchstaben und Ziffern. */
const normal = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Modulschlüssel zu einer Leser-Datei über ihren Dateinamen (`pages/PersonenPage.tsx` →
 * `personen`). Verglichen gegen Schlüssel UND Route, weil beide auseinanderfallen können
 * (`gefahrenzonen` hat die Route `gefahren`).
 */
export function modulZuLeserDatei(pfad: string): string[] {
  const basis = normal((pfad.split('/').pop() ?? '').replace(/\.tsx?$/, '')).replace(/page$/, '');
  if (!basis) return [];
  return modulRegistry
    .filter((m) => [m.key, m.route, modulZielRoute(m)].some((s) => normal(s) === basis))
    .map((m) => m.key);
}

/** Je Parameter: Modulschlüssel → Leser-Dateien dieses Moduls. */
const LESER_MODULE = new Map<SchnellaktionParameter, Map<string, string[]>>();
for (const [p, leser] of LESER) {
  const module = new Map<string, string[]>();
  for (const l of leser) {
    for (const key of modulZuLeserDatei(l.pfad)) {
      module.set(key, [...(module.get(key) ?? []), l.pfad]);
    }
  }
  LESER_MODULE.set(p, module);
}

const zeige = (l: Leser): string => `${l.pfad}:${l.zeile}`;

/**
 * LEERLAUF-SCHUTZ: über einer leeren Tabelle wäre die Deckung trivial wahr, über einer leeren
 * Fundmenge trivial falsch; beide Enden werden festgenagelt.
 */
describe('Schnellaktionen-Guard: der Scan läuft überhaupt', () => {
  it('scannt die Quellen und findet Leser', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(200);
    // Beide Aktionsarten sind in Gebrauch; fiele eine weg, prüfte der Guard sie still nicht mehr.
    expect([...PARAMETER].sort()).toEqual(['neu', 'zeichnen']);
    for (const p of PARAMETER) {
      expect(
        LESER.get(p)!.length,
        `kein einziger \`?${p}\`-Leser gefunden — Glob oder Prädikat kaputt`,
      ).toBeGreaterThan(0);
    }
    expect(
      SCHNELLAKTIONEN.length,
      'leere Schnellaktions-Tabelle macht jede Aussage unten trivial',
    ).toBeGreaterThan(0);
  });

  /**
   * SELBSTBEWEIS: die Trennschärfe gegen Kommentar, Text und fremden Schlüssel ist der Grund für
   * den AST.
   */
  it('findet den echten Aufruf und NICHT Kommentar, Text oder fremden Schlüssel', () => {
    const quelle = `
      // Schnellaktion: ?neu=1 öffnet die Erfassung, ?zeichnen=gefahrengebiet den Zeichenmodus
      /* auch hier steht searchParams.get('neu') nur als Prosa */
      const a = "neu=1";
      const b = params.get('person');
      const c = params.get("neu");
      const d = suchparameter
        .has('neu');
      const e = searchParams.get('zeichnen');
      const f = "zeichnen=gefahrengebiet";
    `;
    expect(findeLeser('/src/synthetisch.ts', quelle, 'neu').map((l) => l.zeile)).toEqual([6, 7]);
    // Ein `neu`-Leser deckt keine Zeichen-Aktion und umgekehrt.
    expect(findeLeser('/src/synthetisch.ts', quelle, 'zeichnen').map((l) => l.zeile)).toEqual([9]);
  });

  it('prüft das Ziel je Parameter', () => {
    expect(ZIEL_TRAEGT.neu('1')).toBe(true);
    expect(ZIEL_TRAEGT.neu(null)).toBe(false);
    expect(ZIEL_TRAEGT.zeichnen('gefahrengebiet')).toBe(true);
    expect(ZIEL_TRAEGT.zeichnen('1')).toBe(false);
    expect(ZIEL_TRAEGT.zeichnen(null)).toBe(false);
    // Syntaktisch gültig, aber nicht zeichenbar: die Karte räumte nur.
    expect(ZIEL_TRAEGT.zeichnen('absperrgrenze:flaeche')).toBe(false);
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
      // Spiegel des Freigabefilters in `baueBefehle`: ein unfertiges Trägermodul liefert dort keine
      // Schnellaktion.
      expect(
        m!.status,
        `Trägermodul '${a.modulKey}' ist nicht 'fertig' — die Zeile kann nie erscheinen`,
      ).toBe('fertig');
    }
  });
});

describe('Schnellaktionen-Guard: Ziel', () => {
  it('liegt unter dem Modulpfad seines EIGENEN Trägers und trägt den Auftrag seines Parameters', () => {
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
      // Über `URLSearchParams`, damit die Parameterreihenfolge keine Rolle spielt.
      const wert = new URLSearchParams(query).get(a.parameter);
      expect(
        ZIEL_TRAEGT[a.parameter](wert),
        `„${a.label}" (${ziel}) trägt keinen brauchbaren Auftrag ?${a.parameter}= (gelesen: ${wert})`,
      ).toBe(true);
    }
  });
});

describe('Schnellaktionen-Guard: Deckung', () => {
  /** DIE tragende Aussage, eine ZUORDNUNG (siehe Kopfkommentar). */
  it('hat je Eintrag eine Seite seines Trägermoduls, die seinen Parameter wirklich liest', () => {
    for (const a of SCHNELLAKTIONEN) {
      const leser = LESER.get(a.parameter) ?? [];
      const module = LESER_MODULE.get(a.parameter) ?? new Map<string, string[]>();
      expect(
        module.get(a.modulKey) ?? [],
        `Schnellaktion „${a.label}" zeigt auf das Modul '${a.modulKey}', aber KEINE Seite dieses ` +
          `Moduls liest ?${a.parameter}. Gefundene Leser:\n${leser.map(zeige).join('\n')}\n` +
          `Zugeordnet: ${[...module].map(([k, v]) => `${k} ← ${v.join(', ')}`).join(' | ')}`,
      ).not.toHaveLength(0);
    }
  });

  /**
   * Gegenstück: eine Namensdrift schwächte die Zuordnung oben still. Die Umkehrung „jeder Leser
   * gehört zu einer Schnellaktion“ gilt bewusst NICHT: eine Seite darf `?neu=1` lesen, ohne dass
   * die Palette eine Zeile führt.
   */
  it('ordnet jeden gefundenen Leser einem Registry-Modul zu', () => {
    const alle = [...LESER.values()].flat();
    const verwaist = alle.filter((l) => modulZuLeserDatei(l.pfad).length === 0);
    expect(
      verwaist.map(zeige),
      'Diese Dateien lesen einen Schnellaktions-Parameter, ihr Name trifft aber keinen Registry-Eintrag — die ' +
        'Deckungsaussage oben kann sie nicht sehen. Datei umbenennen oder die Zuordnung erweitern.',
    ).toEqual([]);
    const mehrdeutig = alle.filter((l) => modulZuLeserDatei(l.pfad).length > 1);
    expect(mehrdeutig.map(zeige), 'Dateiname trifft mehrere Registry-Einträge').toEqual([]);
  });
});
