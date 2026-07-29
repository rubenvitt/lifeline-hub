import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard der Katalogtabellen (LFH-329 · B1, Gate 2 aus A1; Schließung LFH-330 · G1).
 *
 * ZWEI Hälften, und sie fangen verschiedene Ausfälle:
 *
 * 1. **Das Inventar** — die namentliche 19er-Liste unten. Diese Tabellen laufen über EIN
 *    Primitiv (`components/KatalogTabelle.tsx`), das waagerechten Scrollcontainer, stehende
 *    Kopfzeile und fixierte Identifierspalte setzt. Fiele eine davon auf antd zurück, bräche
 *    nichts sichtbar — sie verschwände am schmalen Schirm still aus dem Gate.
 * 2. **Die Schließung** — ein Scan über den ganzen Dateikorpus `frontend/src`: außerhalb des
 *    Primitivs und der namentlich freigestellten Ausnahmen gibt es KEIN rohes
 *    antd-Tabellenelement. Ohne diese Hälfte sagte der Guard bloß „diese 19 sind migriert"
 *    und nichts über die zwanzigste, neu hinzukommende. `datensicht.guard.test.ts` verweist
 *    im Dateikopf für genau diesen Fall hierher („ein Konsument, der gar nichts von
 *    `Datensicht` weiß") — bis LFH-330 · G1 war das ein Versprechen ohne Gegenstand.
 *
 * ── BEKANNTE GRENZEN, und sie sind Teil des Vertrags ────────────────────────────
 *
 * 1. **Die 19er-Liste bleibt handgepflegt, nicht erschnüffelt.** Eine neue Katalogseite in
 *    `stammdaten/` taucht dort nicht von selbst auf. Bindet sie antd direkt ein, fängt sie
 *    die Schließung; baut sie korrekt auf dem Primitiv, steht sie danach trotzdem nicht im
 *    Inventar. Das Inventar sichert den benannten Bestand gegen Rückfall, nicht den Zuwachs
 *    gegen Auslassung — dafür ist es die falsche Bauart, und ein Verzeichnis-Scan wäre die
 *    falsch-positive (Modals, Listen, Untertabellen wollen kein Primitiv).
 * 2. **Andere Darstellungsformen sieht keine der beiden Hälften.** Eine Liste aus
 *    handgesetzten `div`s oder über `components/Liste.tsx` ist hier unsichtbar; die Formfrage
 *    Tabelle-gegen-Liste regelt die Bedien-Leitlinie, nicht dieser Scan.
 * 3. **Die Aliastür bleibt offen.** Ein `import { Table as AntTabelle }` mit anschließendem
 *    `<AntTabelle` entgeht der Marke. Bewusst nicht abgedeckt: dafür müsste der Scanner
 *    Importbindungen auflösen, und im Bestand ist der Fall nirgends belegt.
 * 4. **Der Guard liest über `node:fs`, nicht über `import.meta.glob`** — dieselbe
 *    Begründung wie in `theme/gate5.guard.test.ts`: der Glob liefert je nach Vitest-
 *    Konfiguration Leerstrings und macht den Scan zur Attrappe.
 * 5. **Kommentare sind ausgenommen.** Über die abgelöste Schreibweise darf man reden.
 *    Der Stripper trägt einen Block-Zustand über Zeilengrenzen; ein `//` innerhalb eines
 *    Strings blendet den Zeilenrest aus — das erzeugt Falsch-Negative, nie Falsch-Positive.
 * 6. **Der Scanner beweist sich selbst** (die Selbstbeweis-Fälle): ohne diesen Beleg wäre ein
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
const KATALOGE = [
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
];

/**
 * Die sechs Nachzügler des Überlaufschutzes. Getrennt gehalten, weil eine Zusicherung nur
 * für die Kataloge gilt (die Blätterungsschwelle unten) — eine flache 19er-Liste könnte das
 * nicht ausdrücken, ohne die sechs mitzuverpflichten.
 */
const UEBERLAUF_NACHZUG = [
  'pages/bereitstellungsraum/BereitstellungsraeumePage.tsx',
  'pages/UnfallhilfsstellenPage.tsx',
  'pages/SchaedenPage.tsx',
  'pages/PersonenDetailPage.tsx',
  'pages/uhs/MaterialTab.tsx',
  'pages/MitgliederAbschnitt.tsx',
];

const KATALOGTABELLEN = [...KATALOGE, ...UEBERLAUF_NACHZUG];

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

// ── Hälfte 2: die repoweite Schließung (LFH-330 · G1) ─────────────────────────────

/** Der Korpus umfasst Quell- und Typdateien; `.tsx` allein verfehlte künftige Helfermodule. */
const ENDUNGEN = /\.(ts|tsx)$/;

/**
 * Namentlich freigestellt — Begründung je Eintrag, und jeder Eintrag muss GEBRAUCHT werden
 * (siehe {@link rohtabellenBefunde}: eine tote Freistellung wird gemeldet, nicht geduldet).
 */
const AUSNAHMEN = [
  // Das Primitiv selbst. Es bindet antd ein, damit es niemand sonst tun muss.
  '/src/components/KatalogTabelle.tsx',
  // Flächencodierung Gefahrentyp × Schutzobjekt: eine Matrix, in der jede Zelle ein eigener
  // Sachverhalt ist — kein Listenvergleich, also auch keine Katalogtabelle. Sie trägt
  // waagerechten Bildlauf und die fixierte Kennungsspalte (`fixed: 'left'`) selbst; es fehlt
  // allein die stehende Kopfzeile. Das ist ein benannter Restposten, kein Freibrief.
  '/src/pages/gefahren/GefahrenMatrix.tsx',
];

/** Alle Quelldateien als Rohtext, Schlüssel relativ zur Wurzel (`/src/…`). */
function lieseKorpus(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseKorpus(pfad, `${praefix}/${eintrag.name}`));
    } else if (ENDUNGEN.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/**
 * Rohe antd-Tabellenelemente im ganzen Korpus. Meldet Verstöße UND tote Freistellungen in
 * EINER Liste — Bauart aus `useViewport.guard.test.ts`. Rein und exportiert, damit die
 * Selbstbeweis-Fälle sie ohne Dateisystem prüfen können.
 *
 * WARNSATZ, gemessen: **der Kommentar-Stripper sieht STRING-LITERALE nicht.** Zwölf der
 * vierzehn repoweiten Fundstellen stehen heute in Selbstbeweis-Konstanten dieser Datei und
 * von `datensicht.guard.test.ts`; grün bleibt die Schließung allein durch den
 * `*.test.*`-Ausschluss unten. Wer eine solche Konstante in eine PRODUKTIVdatei legt, bricht
 * die Schließung und sucht die Ursache dann im Muster statt hier.
 *
 * Die Marke ist {@link elementMuster} — dieselbe Funktion wie im Inventar, absichtlich nicht
 * nachgebaut: nur so gilt ihr bereits geführter Selbstbeweis (`<TableColumnsType` ist kein
 * Tabellenelement, `<Table<T>` schon) auch für diese Hälfte.
 */
export function rohtabellenBefunde(dateien: Record<string, string>, ausnahmen: string[]): string[] {
  const befunde: string[] = [];
  const belegt = new Set<string>();

  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (/\.test\.[jt]sx?$/.test(pfad)) continue;
    if (/\.generated\.[jt]sx?$/.test(pfad)) continue;
    const freigestellt = ausnahmen.includes(pfad);
    ohneKommentare(inhalt)
      .split('\n')
      .forEach((zeile, i) => {
        // `elementMuster()` liefert ein /g/-Regex — deshalb je Zeile ein FRISCHES. Ein
        // hochgezogenes, wiederverwendetes trüge seinen `lastIndex` über Zeilengrenzen und
        // überspränge Fundstellen still; genau die Falle, die `useViewport.guard.test.ts`
        // durch ein Muster ohne `g` umgeht.
        if (treffer(zeile, elementMuster('Table')) === 0) return;
        if (freigestellt) {
          belegt.add(pfad);
          return;
        }
        befunde.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
      });
  }

  for (const eintrag of ausnahmen) {
    if (!belegt.has(eintrag)) befunde.push(`tote Ausnahme: ${eintrag}`);
  }
  return befunde;
}

const KORPUS = lieseKorpus(SRC);

describe('KatalogTabelle-Inventar', () => {
  it('alle 19 Tabellen laufen über das Primitiv', () => {
    expect(QUELLEN).toHaveLength(19);

    const ohnePrimitiv = QUELLEN.filter(
      (q) => treffer(q.text, elementMuster('KatalogTabelle')) < 1,
    );
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

  it('die Blätterungsschwelle der Kataloge hat lebende Konsumenten', () => {
    /**
     * Ohne diese Zusicherung ist `BLAETTER_SCHWELLE` eine Attrappe: das Primitiv blättert
     * ab fünfzig Zeilen, aber ein Aufrufer mit `pagination={false}` schaltet das ab — und
     * zwar lautlos, weil abgeschaltete Blätterung genauso aussieht wie eine Liste unter der
     * Schwelle. Gemessen war das der Zustand direkt nach der Einführung: zwanzig Konsumenten,
     * zwanzig Abschaltungen, null Wirkung.
     *
     * Nur die dreizehn Kataloge sind verpflichtet. Die sechs Nachzügler des Überlaufschutzes
     * dürfen weiter abschalten — dort ist Blätterung fachlich nicht bestellt (Audit-Protokoll,
     * Abschnitts-Mitglieder), und `components/Datensicht.tsx` schaltet sie mit eigener,
     * im Code hinterlegter Begründung ab: eine Seitenblätterung schnitte die Zeilenschleuse
     * entzwei, und Kriterium 12 hat Vorrang.
     */
    const abgeschaltet = QUELLEN.filter(
      (q) => KATALOGE.includes(q.pfad) && /pagination=\{false\}/.test(q.text),
    );
    expect(abgeschaltet.map((q) => q.pfad)).toEqual([]);

    const primitiv = ohneKommentare(
      readFileSync(join(SRC, 'components', 'KatalogTabelle.tsx'), 'utf8'),
    );
    expect(primitiv).toContain('BLAETTER_SCHWELLE');
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

describe('KatalogTabelle-Schließung', () => {
  it('außerhalb des Primitivs und der Ausnahmen gibt es kein rohes antd-Tabellenelement', () => {
    expect(
      rohtabellenBefunde(KORPUS, AUSNAHMEN),
      `Eine Tabelle gehört hinter components/KatalogTabelle.tsx (Bildlauf, stehende Kopfzeile, ` +
        `fixierte Kennung) oder hinter components/Datensicht.tsx. Wer antd wirklich direkt ` +
        `braucht, trägt die Datei mit Begründung in AUSNAHMEN ein — und streicht den Eintrag ` +
        `wieder, sobald sie migriert ist.`,
    ).toEqual([]);
  });

  it('Sentinel: der Korpus ist wirklich gelesen', () => {
    /**
     * Zwei Netze gegen einen stillen Leerlauf, und sie fangen Verschiedenes: eine falsche
     * Wurzel oder Endung ließe den Korpus schrumpfen (das hier), und der Guard fände dann
     * schlicht nichts mehr. Die Totmeldung oben ist das zweite Netz — bei leerem Korpus
     * gölten BEIDE Ausnahmen als tot, der Schließungstest wird also rot statt grün.
     */
    expect(Object.keys(KORPUS).length).toBeGreaterThan(200);
    expect(KORPUS['/src/components/KatalogTabelle.tsx'] ?? '').not.toBe('');
  });

  it('Selbstbeweis: eine erfundene Fundstelle wird gemeldet, die freigestellte nicht', () => {
    const zeile = 'const a = <Table<Uhs> rowKey="id" columns={SPALTEN} />;';
    const baum = {
      '/src/pages/Irgendwas.tsx': zeile,
      '/src/components/KatalogTabelle.tsx': zeile,
      // Testdateien sind ausgenommen: dort steht die verbotene Form als Selbstbeweis.
      '/src/pages/Irgendwas.test.tsx': zeile,
    };

    expect(rohtabellenBefunde(baum, ['/src/components/KatalogTabelle.tsx'])).toEqual([
      `/src/pages/Irgendwas.tsx:1  ${zeile}`,
    ]);
  });

  it('Totmeldung: eine migrierte Ausnahme erzwingt die Streichung ihres Eintrags', () => {
    /**
     * Ohne diesen Fall bliebe eine Freistellung nach der Migration stehen und deckte
     * stillschweigend den nächsten Rückfall in derselben Datei. Der Guard verlangt deshalb
     * das Streichen, statt den toten Eintrag zu dulden.
     */
    const baum = {
      '/src/pages/gefahren/GefahrenMatrix.tsx': 'const a = <KatalogTabelle rowKey="typ" />;',
    };

    expect(rohtabellenBefunde(baum, ['/src/pages/gefahren/GefahrenMatrix.tsx'])).toEqual([
      'tote Ausnahme: /src/pages/gefahren/GefahrenMatrix.tsx',
    ]);
  });

  it('Selbstbeweis: der Zeilenzähler überspringt keine zweite Fundstelle', () => {
    /**
     * `elementMuster()` trägt das `g`-Flag. Würde das Muster über die Zeilen hinweg
     * wiederverwendet, trüge es seinen `lastIndex` mit und fände die zweite Fundstelle je
     * nach Spaltenlage nicht mehr — ein Falsch-Negativ, das kein anderer Fall hier zeigt.
     */
    const baum = {
      '/src/pages/Zwei.tsx': [
        'const a = <Table rowKey="id" />;',
        'const b = <KatalogTabelle rowKey="id" />;',
        'const c = <Table rowKey="id" />;',
      ].join('\n'),
    };

    expect(rohtabellenBefunde(baum, [])).toEqual([
      '/src/pages/Zwei.tsx:1  const a = <Table rowKey="id" />;',
      '/src/pages/Zwei.tsx:3  const c = <Table rowKey="id" />;',
    ]);
  });
});
