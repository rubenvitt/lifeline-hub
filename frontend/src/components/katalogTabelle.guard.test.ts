import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard der Katalogtabellen (LFH-329 · B1, Gate 2; Schließung LFH-330 · G1; Ordnung LFH-330 · O).
 *
 * Drei Teile, und sie fangen verschiedene Ausfälle:
 *
 * 1. **Das Inventar** — die namentliche 18er-Liste unten läuft über EIN Primitiv
 *    (`components/KatalogTabelle.tsx`: Scrollcontainer, stehende Kopfzeile, fixierte Kennung).
 *    Fiele eine auf antd zurück, verschwände sie am schmalen Schirm still aus dem Gate.
 * 2. **Die Schließung** — ein Scan über `frontend/src`: außerhalb des Primitivs und der
 *    namentlichen Ausnahmen gibt es KEIN rohes antd-Tabellenelement. Ohne ihn sagte der Guard
 *    nichts über eine neu hinzukommende Tabelle.
 * 3. **Die Ordnung** — die dreizehn Kataloge tragen Sortierung, Filterachse und Freitextsuche
 *    an der Aufrufstelle, nicht bloß das Primitiv darunter. Teil 1 sähe einen Rückbau nicht.
 *    Siehe {@link ordnungsBefunde}.
 *
 * ── BEKANNTE GRENZEN, Teil des Vertrags ───────────────────────────────────────────
 *
 * 1. **Die 18er-Liste ist handgepflegt.** Sie sichert den Bestand gegen Rückfall, nicht den
 *    Zuwachs gegen Auslassung; ein Verzeichnis-Scan wäre falsch-positiv (Modals, Listen,
 *    Untertabellen wollen kein Primitiv).
 * 2. **Andere Darstellungsformen sieht keiner der drei Teile** (handgesetzte `div`s,
 *    `components/Liste.tsx`); die Formfrage regelt die Bedien-Leitlinie.
 * 3. **Die Aliastür bleibt offen.** `import { Table as AntTabelle }` entgeht der Marke; dafür
 *    müsste der Scanner Importbindungen auflösen, und der Fall ist nirgends belegt.
 * 4. **Gelesen wird über `node:fs`, nicht `import.meta.glob`** (siehe `theme/gate5.guard.test.ts`).
 * 5. **Kommentare sind ausgenommen.** Der Stripper trägt einen Block-Zustand über Zeilengrenzen;
 *    ein `//` in einem String blendet den Zeilenrest aus — Falsch-Negative, nie Falsch-Positive.
 * 6. **Der Scanner beweist sich selbst** (Selbstbeweis-Fälle), sonst wäre ein verunglücktes
 *    Muster still grün.
 * 7. **Die Ordnung zählt Vorkommen, nicht Wirkung.** Ob die Vergleichsfunktion richtig
 *    vergleicht, prüfen die Verhaltenstests; dieses Gate fängt den stillen Rückbau. Ein zur
 *    Laufzeit abgeschaltetes Prop (`suche={istAdmin ? … : undefined}`) sieht es nicht.
 * 8. **Auch die Ordnung sieht keine String-Literale** (WARNSATZ an {@link rohtabellenBefunde}).
 *    Für diesen Teil ändert der Stripper heute keine Zählung (die Muster tragen den Doppelpunkt,
 *    die Prosa nicht); er bleibt, weil die Schließung dieselbe Funktion braucht und ein Zeichen
 *    Abstand genügte. Der Selbstbeweis zeigt ihn deshalb an einem gebauten Fall.
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
 * Die achtzehn Tabellen hinter dem Primitiv — dreizehn Kataloge (zehn Stammdaten-Reiter, zwei
 * Karten-Sektionen, Benutzer) und fünf Einsatz-/Verwaltungstabellen als Überlaufschutz.
 *
 * Die fünf sind KEINE `Datensicht`-Konsumenten: sie bekommen nur Scrollcontainer, stehende
 * Kopfzeile und fixierte Kennung, ihr Guard-Ort ist deshalb dieses Inventar. Das ETB ist eine
 * Zeitachse und läuft über keines der beiden Primitive.
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
 * Die fünf Nachzügler des Überlaufschutzes, getrennt gehalten, weil die Blätterungsschwelle nur
 * für die Kataloge gilt. Wer über `Datensicht` rendert (`SchaedenPage`, `PersonenPage`,
 * `TierePage`), gehört nach `datensicht.guard.test.ts`, nicht hierher.
 */
const UEBERLAUF_NACHZUG = [
  'pages/bereitstellungsraum/BereitstellungsraeumePage.tsx',
  'pages/UnfallhilfsstellenPage.tsx',
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

/**
 * Geteilte Bausteine der Kataloge: wer einen davon nutzt, trägt dessen Tabelle, Suche oder
 * Spalten. Ihr Text wird deshalb an den des Katalogs angehängt; geprüft wird weiter je
 * Katalog, und was kein Baustein mitbringt, muss im Katalog selbst stehen.
 */
const HUELLEN: [RegExp, string][] = [
  [elementMuster('KatalogVerwaltung'), 'stammdaten/KatalogVerwaltung.tsx'],
  // Status- und Aktionsspalte der Dienststatus-Kataloge (Fahrzeuge, Personal, Material).
  [/\bdienststatusSpalten</g, 'stammdaten/dienststatus.tsx'],
];

function katalogText(pfad: string): string {
  const eigen = ohneKommentare(readFileSync(join(SRC, pfad), 'utf8'));
  const huellen = HUELLEN.filter(([marke]) => treffer(eigen, marke) > 0).map(([, huelle]) =>
    ohneKommentare(readFileSync(join(SRC, huelle), 'utf8')),
  );
  return [eigen, ...huellen].join('\n');
}

const QUELLEN = KATALOGTABELLEN.map((pfad) => ({ pfad, text: katalogText(pfad) }));

// ── Teil 3: die Ordnung der dreizehn Kataloge (LFH-330 · O) ───────────────────────

/** Spaltensortierung, Filterachse, Freitextsuche — je als Vorkommen im entkommentierten Text. */
const SORTER_MUSTER = /\bsorter:/g;
const FILTER_MUSTER = /\bfilters:/g;
const ONFILTER_MUSTER = /\bonFilter:/g;
/**
 * Das `suche`-Prop ist opt-in; die öffnende Zuweisung gehört ins Muster, ein bloßes `suche`
 * träfe jede gleichnamige Variable.
 *
 * Alle vier Muster tragen `g` und laufen über `treffer()` nur mit `String.match`, das
 * `lastIndex` zurücksetzt. `.test()`/`.exec()` holten die Falle zurück.
 */
const SUCHE_MUSTER = /\bsuche=\{/g;

/**
 * Die drei Kataloge OHNE Filterachse — jeder mit Begründung, und jeder muss GEBRAUCHT werden.
 * Bekommt einer doch eine Filterachse, meldet {@link ordnungsBefunde} den Eintrag als tot; er
 * deckte sonst still den nächsten Rückbau (Bauart wie {@link AUSNAHMEN}).
 */
const OHNE_FILTERACHSE: Record<string, string> = {
  // `StichwortVorschlag` = `{ id, text }`: keine Spalte trägt eine Achse zum Sieben.
  'stammdaten/StichworteTab.tsx':
    'nur Text und Aktionen — der Datensatz trägt keine siebbare Achse',
  // Die einzige denkbare Achse wäre `aktiv`, und die siebt der Server
  // (`personal/qualifikation_repo.rs`, `aktiv = 1`).
  'stammdaten/QualifikationenTab.tsx':
    'Aktiv-Achse serverseitig gesiebt (personal/qualifikation_repo.rs:55, WHERE aktiv = 1)',
  // Wie oben: `einheit/typ_repo.rs` liefert nur `aktiv = 1`, und `EinheitTyp` trägt weder
  // Status noch Kategorie.
  'stammdaten/EinheitTypenTab.tsx':
    'Aktiv-Achse serverseitig gesiebt (einheit/typ_repo.rs:70, WHERE aktiv = 1)',
};

/**
 * Fehlende Ordnung in den dreizehn Katalogen UND tote Filter-Ausnahmen in EINER Liste. Rein und
 * exportiert für die Selbstbeweis-Fälle.
 *
 * `filters` und `onFilter` müssen in der ZAHL übereinstimmen: eine Spalte mit `filters` ohne
 * `onFilter` malt in antd das Menü und siebt nichts, und „mindestens eins" ließe eine
 * funktionierende Filterspalte eine tote daneben decken.
 *
 * GRENZE: gezählt wird je DATEI, nicht je Spalte. Eine Spalte nur mit `filters` und eine nur mit
 * `onFilter` gleichen sich aus; die Spaltenzuordnung verlangte einen Parser.
 *
 * `quellen` trägt bereits ENTKOMMENTIERTEN Text (Grenze 8).
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
    // Ein Eintrag auf eine ungeprüfte Datei (Tippfehler, Umbenennung) sähe wie eine gültige
    // Begründung aus und deckte nichts.
    if (!bekannt.has(eintrag)) befunde.push(`unbekannte Filter-Ausnahme: ${eintrag}`);
  }
  return befunde;
}

// ── Hälfte 2: die repoweite Schließung (LFH-330 · G1) ─────────────────────────────

/** Der Korpus umfasst Quell- und Typdateien; `.tsx` allein verfehlte künftige Helfermodule. */
const ENDUNGEN = /\.(ts|tsx)$/;

/**
 * Namentlich freigestellt — Begründung je Eintrag, und jeder Eintrag muss GEBRAUCHT werden
 * (eine tote Freistellung meldet {@link rohtabellenBefunde}).
 */
const AUSNAHMEN = [
  // Das Primitiv selbst. Es bindet antd ein, damit es niemand sonst tun muss.
  '/src/components/KatalogTabelle.tsx',
  // Matrix Gefahrentyp × Schutzobjekt: jede Zelle ein eigener Sachverhalt, kein Listenvergleich.
  // Sie trägt Bildlauf, fixierte Kennungsspalte und stehende Kopfzeile selbst (letzteres
  // prüft der Fall „GefahrenMatrix" unten).
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
 * Rohe antd-Tabellenelemente im ganzen Korpus: Verstöße UND tote Freistellungen in EINER Liste.
 * Rein und exportiert für die Selbstbeweis-Fälle.
 *
 * WARNSATZ: **der Kommentar-Stripper sieht STRING-LITERALE nicht.** Fast alle repoweiten
 * Fundstellen stehen in Selbstbeweis-Konstanten der Guard-Tests; grün bleibt die Schließung
 * allein durch den `*.test.*`-Ausschluss. Eine solche Konstante in einer Produktivdatei bricht
 * die Schließung.
 *
 * Die Marke ist {@link elementMuster}, dieselbe Funktion wie im Inventar: so gilt ihr
 * Selbstbeweis (`<TableColumnsType` ist kein Tabellenelement, `<Table<T>` schon) auch hier.
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
        // `elementMuster()` liefert ein /g/-Regex, deshalb je Zeile ein FRISCHES: ein
        // wiederverwendetes trüge seinen `lastIndex` über Zeilengrenzen und überspränge Fundstellen.
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
  it('alle 18 Tabellen laufen über das Primitiv', () => {
    expect(QUELLEN).toHaveLength(18);

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
     * Ohne diese Zusicherung ist `BLAETTER_SCHWELLE` eine Attrappe: `pagination={false}` schaltet
     * lautlos ab, und abgeschaltete Blätterung sieht aus wie eine Liste unter der Schwelle.
     *
     * Nur die dreizehn Kataloge sind verpflichtet. Die Nachzügler dürfen abschalten (Blätterung
     * fachlich nicht bestellt), `Datensicht` ebenso: eine Seitenblätterung schnitte die
     * Zeilenschleuse entzwei, und Kriterium 12 hat Vorrang.
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
     * Beide Richtungen: `<Table<Foo>` MUSS als antd-Tabelle zählen, `<KatalogTabelle<Foo>` darf es
     * NICHT (vor `Table` steht kein `<`). Sonst wäre eine Migration grün, die nichts getauscht hat.
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
  /** Nur die dreizehn Kataloge — die fünf Nachzügler tragen die Ordnung ausdrücklich nicht. */
  const KATALOG_QUELLEN = QUELLEN.filter((q) => KATALOGE.includes(q.pfad));

  it('die dreizehn Kataloge sind vollzählig', () => {
    /**
     * Der Zuschnitt ist die halbe Zusicherung: fiele ein Katalog aus `KATALOG_QUELLEN`, prüfte ihn
     * der Fall darunter nicht mehr.
     *
     * Die Nachzügler bleiben draußen, weil sie heute keine Ordnung tragen; sie mitzufordern
     * gebäre das Gate rot. Diese Null wird bewusst NICHT festgeschrieben: bekommt einer Ordnung,
     * wandert er nach `KATALOGE` (oder, über `Datensicht`, ganz aus diesem Inventar).
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
     * Drei Ausfälle in einem Baum: die Befunde verdecken sich nicht gegenseitig (die Schleife
     * sammelt, sie bricht nicht ab).
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
     * Der Fall, den „mindestens ein `filters`" nicht fängt: Datei `e` hat ZWEI Filterspalten, nur
     * eine ist angeschlossen.
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
     * Bekommt ein Ausnahmekatalog doch eine Filterachse, ist seine Begründung überholt; stehen
     * gelassen deckte sie still den Rückbau ebendieser Achse.
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
     * Der zweite Weg in die Wirkungslosigkeit: der Eintrag verfehlt sein Ziel (Tippfehler,
     * Umbenennung) und deckt nichts.
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
     * Der Fall ist GEBAUT (Grenze 8): er sichert gegen die Bauart des Gates — ohne Stripper prüfte
     * es, ob jemand über Sortierung REDET. Die Gegenprobe ist der Beleg: dieselbe Datei, die
     * NICHTS tut, ist ohne Stripper tadellos, allein aus Kommentartext.
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
     * Zwei Netze gegen stillen Leerlauf: eine falsche Wurzel oder Endung ließe den Korpus schrumpfen
     * (das hier), und bei leerem Korpus gölten beide Ausnahmen als tot (die Totmeldung).
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
     * Eine Freistellung nach der Migration deckte still den nächsten Rückfall in derselben Datei;
     * der Guard verlangt das Streichen.
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
     * `elementMuster()` trägt `g`. Über Zeilen wiederverwendet, fände es die zweite Fundstelle je
     * nach Spaltenlage nicht mehr.
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

describe('Freistellungen tragen ihre Begründung (LFH-368 · B5h)', () => {
  it('die Gefahrenmatrix hat die stehende Kopfzeile, die ihre Ausnahme verspricht', () => {
    /**
     * Geprüft wird der Prop-Wert im QUELLTEXT, kein Pixel: jsdom rechnet kein Layout. Bauart wie
     * `aktionsabstand.guard.test.ts`. Hält die Aussage bei {@link AUSNAHMEN} fest, dass die Matrix
     * ihre stehende Kopfzeile selbst trägt.
     *
     * `ohneKommentare` ist nötig, weil {@link KORPUS} ROHTEXT trägt und über dem Prop ein
     * erklärender Kommentar steht (Grenze 8).
     */
    const quelle = ohneKommentare(KORPUS['/src/pages/gefahren/GefahrenMatrix.tsx'] ?? '');
    expect(quelle).toMatch(/^\s*sticky\s*$/m);
  });
});

// ── Teil 4: der Zähler kann nicht lügen (LFH-374) ─────────────────────────────────

/**
 * antds eigene Ausblendwege (`responsive` nach Breite, `hidden` unbedingt) verbärgen eine
 * Spalte, die der Spaltenzähler nicht kennt. `KatalogSpalte` sperrt sie am Typ, aber nur an
 * Objektliteralen; dieser Guard schließt die Lücke je Konsumentendatei. Die Doppelpunkt-Form
 * trifft `overflow: 'hidden'` nicht.
 *
 * BLINDE FLECKEN: gelesen werden nur die achtzehn Konsumentendateien. Eine ausgelagerte
 * Spaltenliste (Muster `personen/personenSpalten.tsx`) sieht er nicht, und eine Typassertion
 * (`[…] as KatalogSpalte<X>[]`) hebelt die Typsperre aus. Wer eine Spaltenliste auslagert,
 * nimmt die Datei hier mit auf.
 */
const AUSBLEND_MUSTER = /\b(?:responsive|hidden)\s*:/g;

/** Konsumenten mit antd-Ausblendung — rein und exportiert für den Selbstbeweis. */
export function ausblendBefunde(quellen: { pfad: string; text: string }[]): string[] {
  return quellen.filter((q) => treffer(q.text, AUSBLEND_MUSTER) > 0).map((q) => q.pfad);
}

describe('KatalogTabelle · Spaltenzähler (LFH-374)', () => {
  it('kein Konsument blendet über antds responsive/hidden aus', () => {
    expect(
      ausblendBefunde(QUELLEN),
      'Eine Spalte, die antd verbirgt, fehlt im Spaltenzähler — genau der Fehler, gegen den ' +
        'Kriterium 14 steht. Breitenabhängig: `abBreite` plus `spaltenSchalter`.',
    ).toEqual([]);
  });

  it('Selbstbeweis: responsive/hidden als Schlüssel zählen, als Wert oder im Kommentar nicht', () => {
    const probe = (text: string) => ausblendBefunde([{ pfad: 'x', text: ohneKommentare(text) }]);
    expect(probe("const s = [{ key: 'a', responsive: ['md'] }];")).toEqual(['x']);
    expect(probe("const s = [{ key: 'a', hidden: true }];")).toEqual(['x']);
    expect(probe("const stil = { overflow: 'hidden' };")).toEqual([]);
    expect(probe('// responsive: im Kommentar\n/* hidden: auch */')).toEqual([]);
  });

  it('Datensicht setzt spaltenSchalter nie — es rendert seinen eigenen Schalter', () => {
    /**
     * Zwei Schalter mit zwei Zuständen wären der Fehlerfall. Das Gegenstück zur Laufzeit steht in
     * `Datensicht.test.tsx` („genau EIN Spaltenschalter").
     */
    const datensicht = ohneKommentare(
      readFileSync(join(SRC, 'components', 'Datensicht.tsx'), 'utf8'),
    );
    expect(treffer(datensicht, /\bspaltenSchalter=/g)).toBe(0);
  });
});
