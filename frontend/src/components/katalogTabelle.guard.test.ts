import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Inventar-Guard der Katalogtabellen (LFH-329 · B1, Gate 2 aus A1).
 *
 * Die dreizehn Verwaltungstabellen laufen über EIN Primitiv (`components/KatalogTabelle.tsx`),
 * das waagerechten Scrollcontainer, stehende Kopfzeile und fixierte Identifierspalte setzt.
 * Eine vierzehnte Tabelle, die antd direkt einbindet, bräche nichts sichtbar — sie fiele
 * am schmalen Schirm still aus dem Gate. Genau das fängt dieser Guard.
 *
 * ── BEKANNTE GRENZEN, und sie sind Teil des Vertrags ────────────────────────────
 *
 * 1. **Die Dateiliste ist handgepflegt, nicht erschnüffelt.** Eine neue Katalogseite in
 *    `stammdaten/` fällt hier NICHT auf; der Guard sichert den migrierten Bestand gegen
 *    Rückfall, nicht den Zuwachs gegen Auslassung. Ein Verzeichnis-Scan wäre die
 *    schärfere, aber auch die falsch-positive Variante (Modals, Listen, Untertabellen).
 * 2. **Der Guard liest über `node:fs`, nicht über `import.meta.glob`** — dieselbe
 *    Begründung wie in `theme/gate5.guard.test.ts`: der Glob liefert je nach Vitest-
 *    Konfiguration Leerstrings und macht den Scan zur Attrappe.
 * 3. **Kommentare sind ausgenommen.** Über die abgelöste Schreibweise darf man reden.
 *    Der Stripper trägt einen Block-Zustand über Zeilengrenzen; ein `//` innerhalb eines
 *    Strings blendet den Zeilenrest aus — das erzeugt Falsch-Negative, nie Falsch-Positive.
 * 4. **Der Scanner beweist sich selbst** (letzter Test): ohne diesen Beleg wäre ein
 *    verunglücktes Muster still grün und der Guard wertlos.
 */

/** Wurzel des Scans: `frontend/src`, über `process.cwd()` aufgelöst (siehe gate5.guard). */
const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'components', 'KatalogTabelle.tsx'))) return pfad;
  }
  throw new Error(`Katalogtabellen-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

/**
 * Die neunzehn Tabellen hinter dem Primitiv — dreizehn Kataloge (zehn Stammdaten-Reiter,
 * zwei Karten-Sektionen, Benutzer) und sechs Einsatz-/Verwaltungstabellen, die LFH-330 · B2
 * als Überlaufschutz nachgezogen hat.
 *
 * Die sechs Neuzugänge sind ausdrücklich KEINE `Datensicht`-Konsumenten (E3/E4): sie
 * bekommen nur waagerechten Scrollcontainer, stehende Kopfzeile und fixierte Kennung. Ihr
 * Guard-Ort ist deshalb dieses Inventar und nicht `datensicht.guard.test.ts`.
 *
 * `etb/EtbTabelle.tsx` ist die zwanzigste Konsumentin und steht bewusst NICHT hier: sie
 * arbeitet auf einem serverseitigen 100-Zeilen-Fenster. Ihre Aufnahme ist ein benannter
 * Restposten (LFH-330 · AP8), kein stiller Nebeneffekt.
 */
const KATALOGTABELLEN = [
  'stammdaten/QualifikationenTab.tsx',
  'stammdaten/SprechgruppenTab.tsx',
  'stammdaten/FahrzeugeTab.tsx',
  'stammdaten/PersonalTab.tsx',
  'stammdaten/StichworteTab.tsx',
  'stammdaten/StatusKatalogTab.tsx',
  'stammdaten/EtbBausteineTab.tsx',
  'stammdaten/MaterialTab.tsx',
  'stammdaten/PersonalStatusTab.tsx',
  'stammdaten/EinheitTypenTab.tsx',
  'karten/OnlineQuellenVerwaltung.tsx',
  'karten/OfflineKartenVerwaltung.tsx',
  'pages/BenutzerPage.tsx',
  'pages/bereitstellungsraum/BereitstellungsraeumePage.tsx',
  'pages/UnfallhilfsstellenPage.tsx',
  'pages/SchaedenPage.tsx',
  'pages/PersonenDetailPage.tsx',
  'pages/uhs/MaterialTab.tsx',
  'pages/MitgliederAbschnitt.tsx',
];

/** Entfernt Zeilen- und Blockkommentare, Block-Zustand über Zeilengrenzen getragen. */
function ohneKommentare(quelle: string): string {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of quelle.split('\n')) {
    let zeile = '';
    for (let i = 0; i < roh.length; i += 1) {
      if (imBlock) {
        if (roh.startsWith('*/', i)) {
          imBlock = false;
          i += 1;
        }
        continue;
      }
      if (roh.startsWith('/*', i)) {
        imBlock = true;
        i += 1;
        continue;
      }
      if (roh.startsWith('//', i)) break;
      zeile += roh[i];
    }
    zeilen.push(zeile);
  }
  return zeilen.join('\n');
}

/** Öffnendes JSX-Element eines Namens — `<Name` gefolgt von Leerraum, `>` oder Generik. */
function elementMuster(name: string): RegExp {
  return new RegExp(`<${name}(?=[\\s/>{<])`, 'g');
}

/** Setzungen des waagerechten Scrollcontainers am antd-Tabellenelement. */
const SCROLL_MUSTER = /\bscroll=\{\{/g;

function treffer(text: string, muster: RegExp): number {
  return text.match(muster)?.length ?? 0;
}

const QUELLEN = KATALOGTABELLEN.map((pfad) => ({
  pfad,
  text: ohneKommentare(readFileSync(join(SRC, pfad), 'utf8')),
}));

describe('KatalogTabelle-Inventar', () => {
  it('alle 19 Tabellen laufen über das Primitiv', () => {
    expect(QUELLEN).toHaveLength(19);

    const ohnePrimitiv = QUELLEN.filter((q) => treffer(q.text, elementMuster('KatalogTabelle')) < 1);
    expect(ohnePrimitiv.map((q) => q.pfad)).toEqual([]);

    const mitAntdTabelle = QUELLEN.filter((q) => treffer(q.text, elementMuster('Table')) > 0);
    expect(mitAntdTabelle.map((q) => q.pfad)).toEqual([]);
  });

  it('nur das Primitiv setzt den waagerechten Scrollcontainer', () => {
    const eigenmaechtig = QUELLEN.filter((q) => treffer(q.text, SCROLL_MUSTER) > 0);
    expect(eigenmaechtig.map((q) => q.pfad)).toEqual([]);

    const primitiv = ohneKommentare(
      readFileSync(join(SRC, 'components', 'KatalogTabelle.tsx'), 'utf8'),
    );
    expect(treffer(primitiv, SCROLL_MUSTER)).toBe(1);
    expect(treffer(primitiv, /\bsticky\b/g)).toBeGreaterThan(0);
    expect(treffer(primitiv, /fixed: 'left'/g)).toBe(1);
  });

  it('der Scanner findet die verbotenen Formen wirklich (Selbstbeweis)', () => {
    const probe = ohneKommentare(
      [
        '// <Table und scroll={{ x }} im Kommentar zählen nicht',
        '/* <Table auch hier nicht */',
        'const a = <Table rowKey="id" scroll={{ x: 1 }} />;',
        'const b = <KatalogTabelle rowKey="id" />;',
        'const c = <TableColumnsType />;',
      ].join('\n'),
    );
    expect(treffer(probe, elementMuster('Table'))).toBe(1);
    expect(treffer(probe, SCROLL_MUSTER)).toBe(1);
    expect(treffer(probe, elementMuster('KatalogTabelle'))).toBe(1);
  });

  it('die generische Schreibweise wird richtig zugeordnet (Selbstbeweis)', () => {
    /**
     * Die sechs Migrationen von LFH-330 · B2 schreiben durchweg die generische Form
     * (`<KatalogTabelle<Uhs>`), weil `T extends object` sonst nicht gebunden ist. Genau darauf
     * ruht die ganze Migrationsprüfung — also wird beide Richtungen belegt: `<Table<Foo>` MUSS
     * als antd-Tabelle zählen, `<KatalogTabelle<Foo>` darf es NICHT (dort steht vor `Table`
     * kein `<`). Ohne diesen Fall wäre eine Migration grün, die gar nichts getauscht hat.
     */
    const probe = ohneKommentare(
      [
        'const a = <KatalogTabelle<Uhs> rowKey="id" columns={SPALTEN} />;',
        'const b = <Table<Uhs> rowKey="id" />;',
      ].join('\n'),
    );
    expect(treffer(probe, elementMuster('KatalogTabelle'))).toBe(1);
    expect(treffer(probe, elementMuster('Table'))).toBe(1);
  });
});
