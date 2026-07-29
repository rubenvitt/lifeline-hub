import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard der Katalogtabellen (LFH-329 · B1, Gate 2 aus A1; Schließung LFH-330 · G1;
 * Ordnung LFH-330 · O).
 *
 * DREI Teile, und sie fangen verschiedene Ausfälle:
 *
 * 1. **Das Inventar** — die namentliche 19er-Liste unten. Diese Tabellen laufen über EIN
 *    Primitiv (`components/KatalogTabelle.tsx`), das waagerechten Scrollcontainer, stehende
 *    Kopfzeile und fixierte Identifierspalte setzt. Fiele eine davon auf antd zurück, bräche
 *    nichts sichtbar — sie verschwände am schmalen Schirm still aus dem Gate.
 * 2. **Die Schließung** — ein Scan über den ganzen Dateikorpus `frontend/src`: außerhalb des
 *    Primitivs und der namentlich freigestellten Ausnahmen gibt es KEIN rohes
 *    antd-Tabellenelement. Ohne diesen Teil sagte der Guard bloß „diese 19 sind migriert"
 *    und nichts über die zwanzigste, neu hinzukommende. `datensicht.guard.test.ts` verweist
 *    im Dateikopf für genau diesen Fall hierher („ein Konsument, der gar nichts von
 *    `Datensicht` weiß") — bis LFH-330 · G1 war das ein Versprechen ohne Gegenstand.
 * 3. **Die Ordnung** — die dreizehn Kataloge tragen Sortierung, Filterachse und Freitextsuche
 *    auch WIRKLICH, nicht bloß das Primitiv darunter. Das schließt genau den Ausgangsbefund
 *    von LFH-330: Fähigkeiten am Primitiv vorhanden, an den Aufrufstellen nicht angeschlossen.
 *    Teil 1 sähe einen Rückbau nicht — `<KatalogTabelle>` ohne einen einzigen `sorter` ist dort
 *    tadellos. Siehe {@link ordnungsBefunde}.
 *
 * ── BEKANNTE GRENZEN, und sie sind Teil des Vertrags ────────────────────────────
 *
 * 1. **Die 19er-Liste bleibt handgepflegt, nicht erschnüffelt.** Eine neue Katalogseite in
 *    `stammdaten/` taucht dort nicht von selbst auf. Bindet sie antd direkt ein, fängt sie
 *    die Schließung; baut sie korrekt auf dem Primitiv, steht sie danach trotzdem nicht im
 *    Inventar. Das Inventar sichert den benannten Bestand gegen Rückfall, nicht den Zuwachs
 *    gegen Auslassung — dafür ist es die falsche Bauart, und ein Verzeichnis-Scan wäre die
 *    falsch-positive (Modals, Listen, Untertabellen wollen kein Primitiv).
 * 2. **Andere Darstellungsformen sieht keiner der drei Teile.** Eine Liste aus
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
 * 7. **Die Ordnung zählt Vorkommen, nicht Wirkung.** Sie belegt, dass `sorter`, `filters` und
 *    das `suche`-Prop an der Aufrufstelle STEHEN — nicht, dass die Vergleichsfunktion richtig
 *    vergleicht. Das prüfen die Verhaltenstests (`KatalogTabelle.test.tsx` und die
 *    Seiten-Tests); dieses Gate fängt allein den stillen Rückbau. Ebenso ungesehen bleibt ein
 *    zur Laufzeit abgeschaltetes Prop (`suche={istAdmin ? … : undefined}`): im Bestand gibt es
 *    den Fall nicht, und ein Muster dagegen wäre Vorratshaltung. Käme er, gehört er hierher.
 * 8. **Auch die Ordnung sieht keine String-Literale** — siehe den WARNSATZ an
 *    {@link rohtabellenBefunde}. Ein `const hinweis = 'sorter: fehlt';` in einer der dreizehn
 *    Dateien erfüllte ihr `sorter`-Soll. Der Stripper deckt Kommentare ab, und nur die.
 *
 *    **Für DIESEN Teil ist er heute nicht tragend, und das ist gemessen:** über alle dreizehn
 *    Dateien ändert er keine einzige der vier Zählungen. Grund ist die Doppelpunkt-Form der
 *    Muster — die Prosa führt genau EIN nacktes Vorkommen (`filters` in
 *    `karten/OnlineQuellenVerwaltung.tsx:65`, „BEWUSST OHNE `filters`"), und dem fehlt der
 *    Doppelpunkt. Er bleibt trotzdem, aus zwei Gründen: es ist dieselbe Funktion, die die
 *    Schließung braucht (dort IST sie tragend), und der Abstand zwischen jener Prosastelle und
 *    einem gezählten Treffer beträgt ein Zeichen. Der Selbstbeweis unten zeigt den Mechanismus
 *    deshalb an einem gebauten Fall, nicht am Bestand — wer den Stripper hier herausnimmt,
 *    sieht kein rotes Gate und hat die Zusicherung trotzdem auf Prosa gestellt.
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

// ── Teil 3: die Ordnung der dreizehn Kataloge (LFH-330 · O) ───────────────────────

/** Spaltensortierung, Filterachse, Freitextsuche — je als Vorkommen im entkommentierten Text. */
const SORTER_MUSTER = /\bsorter:/g;
const FILTER_MUSTER = /\bfilters:/g;
const ONFILTER_MUSTER = /\bonFilter:/g;
/**
 * Das `suche`-Prop ist opt-in (`KatalogTabelle.tsx:57`, `suche?: { platzhalter: string }`) —
 * ohne es existiert weder Feld noch `/`-Kürzel. Die öffnende Zuweisung gehört mit ins Muster:
 * ein bloßes `suche` träfe auch jede gleichnamige Variable oder Destrukturierung.
 *
 * Alle vier Muster tragen `g` und werden über `treffer()` nur mit `String.match` gefahren —
 * das setzt `lastIndex` zurück, anders als `.test()`/`.exec()`. Wer hier auf `.test()`
 * umstellt, holt sich die Falle, vor der der Zeilenzähler der Schließung warnt.
 */
const SUCHE_MUSTER = /\bsuche=\{/g;

/**
 * Die drei Kataloge OHNE Filterachse — jeder mit Begründung, und jeder muss GEBRAUCHT werden.
 * Bekommt einer von ihnen später doch eine Filterachse, meldet {@link ordnungsBefunde} den
 * Eintrag als tot; er wird dann gestrichen, nicht geduldet. Ein toter Eintrag deckte sonst
 * still den nächsten Rückbau in derselben Datei — dieselbe Bauart wie {@link AUSNAHMEN}.
 */
const OHNE_FILTERACHSE: Record<string, string> = {
  // `StichwortVorschlag` = `{ id, text }`. Zwei Spalten (Stichwort, Aktionen), keine davon
  // trägt eine Achse zum Sieben. Eine Filterachse müsste man erfinden.
  'stammdaten/StichworteTab.tsx':
    'nur Text und Aktionen — der Datensatz trägt keine siebbare Achse',
  // Die einzige denkbare Achse wäre `aktiv`, und die siebt schon der Server:
  // `personal/qualifikation_repo.rs:55` liefert `WHERE org_id = ? AND aktiv = 1`. Die Liste
  // enthält also gar keine inaktive Zeile, gegen die ein Filter etwas ausrichten könnte.
  'stammdaten/QualifikationenTab.tsx':
    'Aktiv-Achse serverseitig gesiebt (personal/qualifikation_repo.rs:55, WHERE aktiv = 1)',
  // Gleiche Lage, zweite Quelle: `einheit/typ_repo.rs:70` liefert `WHERE org_id = ? AND
  // aktiv = 1`. `EinheitTyp` trägt darüber hinaus weder Status noch Kategorie; die Begründung
  // steht auch am Spaltenblock der Datei selbst.
  'stammdaten/EinheitTypenTab.tsx':
    'Aktiv-Achse serverseitig gesiebt (einheit/typ_repo.rs:70, WHERE aktiv = 1)',
};

/**
 * Fehlende Ordnung in den dreizehn Katalogen UND tote Filter-Ausnahmen in EINER Liste —
 * Bauart wie {@link rohtabellenBefunde}. Rein und exportiert, damit die Selbstbeweis-Fälle
 * sie ohne Dateisystem prüfen können.
 *
 * Warum `filters` UND `onFilter` zusammen verlangt werden: eine Spalte mit `filters`, aber
 * ohne `onFilter` malt in antd das Aufklappmenü und siebt nichts. Das ist der Ausgangsbefund
 * dieses Tickets im Kleinen — Fähigkeit sichtbar, nicht angeschlossen. Deshalb reicht
 * „mindestens eins" nicht: die Zahlen müssen ÜBEREINSTIMMEN, sonst deckte eine funktionierende
 * Filterspalte eine tote daneben (gemessen im Bestand: 10 Dateien, Paarung durchweg 1:1,
 * `SprechgruppenTab.tsx` 2:2).
 *
 * GRENZE dieser Paarung: sie zählt je DATEI, nicht je Spalte. Eine Spalte mit `filters` ohne
 * `onFilter` und eine zweite mit `onFilter` ohne `filters` gleichen sich zu 1:1 aus und kämen
 * durch. Im Bestand gibt es den Fall nicht, und die Spaltenzuordnung verlangte einen Parser
 * statt eines Zählers — der Aufwand steht nicht dafür.
 *
 * `quellen` trägt bereits ENTKOMMENTIERTEN Text — siehe Grenze 8 im Dateikopf.
 */
export function ordnungsBefunde(
  quellen: { pfad: string; text: string }[],
  ohneFilterachse: Record<string, string>,
): string[] {
  const befunde: string[] = [];
  const bekannt = new Set(quellen.map((q) => q.pfad));

  for (const { pfad, text } of quellen) {
    if (treffer(text, SORTER_MUSTER) === 0) befunde.push(`${pfad}: kein sorter`);
    if (treffer(text, SUCHE_MUSTER) === 0) befunde.push(`${pfad}: kein suche-Prop`);

    const filter = treffer(text, FILTER_MUSTER);
    const onFilter = treffer(text, ONFILTER_MUSTER);
    if (pfad in ohneFilterachse) {
      if (filter > 0) befunde.push(`tote Filter-Ausnahme: ${pfad}`);
    } else if (filter === 0) {
      befunde.push(`${pfad}: keine Filterachse`);
    }
    if (filter !== onFilter) {
      befunde.push(`${pfad}: ${filter}× filters, aber ${onFilter}× onFilter`);
    }
  }

  for (const eintrag of Object.keys(ohneFilterachse)) {
    // Ein Eintrag auf eine Datei, die gar nicht geprüft wird (Tippfehler, Umbenennung,
    // Verschiebung), wäre wirkungslos und dabei unsichtbar — er sieht wie eine gültige
    // Begründung aus und deckt in Wahrheit nichts.
    if (!bekannt.has(eintrag)) befunde.push(`unbekannte Filter-Ausnahme: ${eintrag}`);
  }
  return befunde;
}

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

describe('KatalogTabelle-Ordnung', () => {
  /** Nur die dreizehn Kataloge — die sechs Nachzügler tragen die Ordnung ausdrücklich nicht. */
  const KATALOG_QUELLEN = QUELLEN.filter((q) => KATALOGE.includes(q.pfad));

  it('die dreizehn Kataloge sind vollzählig', () => {
    /**
     * Der Zuschnitt ist die halbe Zusicherung: fiele ein Katalog aus `KATALOG_QUELLEN`
     * heraus, prüfte der Fall darunter ihn nicht mehr und bliebe still grün.
     *
     * Warum die sechs Nachzügler des Überlaufschutzes draußen bleiben, ist gemessen: sie
     * tragen heute 0× `sorter`, 0× `filters` und 0× `suche`. Sie mitzufordern hieße, das Gate
     * rot zu gebären — ihre Ordnung ist ein eigener Auftrag.
     *
     * Diese Null wird bewusst NICHT festgeschrieben. Rüstet jemand `pages/SchaedenPage.tsx`
     * später Sortierung nach, ist das eine Verbesserung; ein Gate, das dafür rot wird, wird
     * gestrichen statt befolgt. Der Weg dann: die Datei wandert nach `KATALOGE` und schuldet
     * ab da die volle Ordnung.
     */
    expect(KATALOG_QUELLEN).toHaveLength(13);
    expect(KATALOG_QUELLEN.map((q) => q.pfad)).toEqual(KATALOGE);
  });

  it('jeder Katalog trägt Sortierung, Suche und — bis auf drei begründete — eine Filterachse', () => {
    expect(
      ordnungsBefunde(KATALOG_QUELLEN, OHNE_FILTERACHSE),
      `Die dreizehn Kataloge haben mit LFH-330 Sortierung, Filter und Suche bekommen. Wer ` +
        `eine davon herausnimmt, dreht den Ausgangsbefund des Tickets zurück: das Primitiv ` +
        `kann es, die Aufrufstelle nutzt es nicht. Fehlt eine Filterachse aus einem SACHLICHEN ` +
        `Grund, gehört die Datei mit Begründung in OHNE_FILTERACHSE — und wieder heraus, ` +
        `sobald sie eine bekommt.`,
    ).toEqual([]);
  });

  it('Selbstbeweis: fehlende Sortierung, fehlende Suche und fehlender Filter werden benannt', () => {
    /**
     * Drei Ausfälle in einem Baum, damit belegt ist, dass die Befunde sich nicht gegenseitig
     * verdecken (die Schleife sammelt, sie bricht nicht ab). Ohne diesen Fall wäre ein
     * verunglücktes Muster still grün — dieselbe Begründung wie bei den Selbstbeweis-Fällen
     * der Schließung.
     */
    const baum = [
      {
        pfad: 'a.tsx',
        text: 'sorter: (a, b) => 0,\nfilters: [],\nonFilter: () => true,\nsuche={{ platzhalter: "x" }}',
      },
      { pfad: 'b.tsx', text: 'filters: [],\nonFilter: () => true,\nsuche={{ platzhalter: "x" }}' },
      { pfad: 'c.tsx', text: 'sorter: (a, b) => 0,\nfilters: [],\nonFilter: () => true,' },
      { pfad: 'd.tsx', text: 'sorter: (a, b) => 0,\nsuche={{ platzhalter: "x" }}' },
    ];

    expect(ordnungsBefunde(baum, {})).toEqual([
      'b.tsx: kein sorter',
      'c.tsx: kein suche-Prop',
      'd.tsx: keine Filterachse',
    ]);
  });

  it('Selbstbeweis: eine Filterspalte ohne onFilter siebt nichts und wird gemeldet', () => {
    /**
     * Der Fall, den „mindestens ein `filters`" nicht fängt: Datei `e` hat ZWEI Filterspalten,
     * aber nur eine ist angeschlossen. Das Aufklappmenü der zweiten erscheint und tut nichts —
     * genau die Sorte stiller Fehler, gegen die dieses Gate gebaut ist.
     */
    const baum = [
      {
        pfad: 'e.tsx',
        text: 'sorter: (a, b) => 0,\nfilters: [],\nonFilter: () => true,\nfilters: [],\nsuche={{ platzhalter: "x" }}',
      },
    ];

    expect(ordnungsBefunde(baum, {})).toEqual(['e.tsx: 2× filters, aber 1× onFilter']);
  });

  it('Totmeldung: eine nachgerüstete Filterachse erzwingt die Streichung ihres Eintrags', () => {
    /**
     * Bekommt einer der drei Ausnahmekataloge doch eine Filterachse, ist seine Begründung
     * überholt. Sie stehen zu lassen wäre kein harmloser Altbestand: der Eintrag deckte danach
     * still den Rückbau ebendieser neuen Achse.
     */
    const baum = [
      {
        pfad: 'stammdaten/StichworteTab.tsx',
        text: 'sorter: (a, b) => 0,\nfilters: [],\nonFilter: () => true,\nsuche={{ platzhalter: "x" }}',
      },
    ];

    expect(ordnungsBefunde(baum, { 'stammdaten/StichworteTab.tsx': 'Grund' })).toEqual([
      'tote Filter-Ausnahme: stammdaten/StichworteTab.tsx',
    ]);
  });

  it('Totmeldung: eine Ausnahme auf eine ungeprüfte Datei wird gemeldet', () => {
    /**
     * Der zweite Weg in die Wirkungslosigkeit: der Eintrag ist nicht überholt, sondern
     * verfehlt sein Ziel (Tippfehler, Umbenennung, Verschiebung der Datei). Er liest sich wie
     * eine gültige Begründung und deckt in Wahrheit gar nichts.
     */
    const baum = [
      {
        pfad: 'stammdaten/StichworteTab.tsx',
        text: 'sorter: (a, b) => 0,\nsuche={{ platzhalter: "x" }}',
      },
    ];

    expect(
      ordnungsBefunde(baum, {
        'stammdaten/StichworteTab.tsx': 'Grund',
        'stammdaten/StichwortTab.tsx': 'Grund mit Tippfehler',
      }),
    ).toEqual(['unbekannte Filter-Ausnahme: stammdaten/StichwortTab.tsx']);
  });

  it('Selbstbeweis: der Stripper hält die Prosa aus den Zählungen heraus', () => {
    /**
     * Der Fall ist GEBAUT, nicht dem Bestand entnommen, und Grenze 8 sagt warum: heute ändert
     * der Stripper an keiner der dreizehn Dateien eine Zählung. Er sichert also nicht gegen
     * etwas Vorhandenes, sondern gegen die Bauart des Gates — die dreizehn begründen ihre
     * Entscheidungen ausführlich in Prosa, und ohne Stripper prüfte das Gate, ob jemand über
     * Sortierung REDET.
     *
     * Die Gegenprobe ist der eigentliche Beleg: dieselbe Datei, die NICHTS tut, ist ohne
     * Stripper vollkommen tadellos — null Befunde, allein aus Kommentartext.
     */
    const roh = [
      '// sorter: hier nur erwähnt, nicht gesetzt',
      '/* BEWUSST OHNE filters: [] und onFilter: — auch suche={{ }} steht bloß hier */',
      "const spalten = [{ title: 'x' }];",
    ].join('\n');

    expect(ordnungsBefunde([{ pfad: 'f.tsx', text: ohneKommentare(roh) }], {})).toEqual([
      'f.tsx: kein sorter',
      'f.tsx: kein suche-Prop',
      'f.tsx: keine Filterachse',
    ]);
    expect(ordnungsBefunde([{ pfad: 'f.tsx', text: roh }], {})).toEqual([]);
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
