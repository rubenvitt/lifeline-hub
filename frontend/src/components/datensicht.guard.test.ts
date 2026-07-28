import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard des Datensicht-Primitivs (LFH-330 · B2).
 *
 * Zwei Hälften mit zwei verschiedenen Bauarten, aus einem Grund: die Zusicherungen ÜBER
 * `Datensicht.tsx` wirken ab dem ersten Tag, die über seine Konsumenten haben am ersten Tag
 * noch keinen Gegenstand.
 *
 * ── HÄLFTE 1: das Primitiv selbst ───────────────────────────────────────────────
 *
 * Tragend ist die POSITIVE Marke `<KatalogTabelle`. Ohne sie bestünde ein `Datensicht.tsx`,
 * das ein rohes antd-Tabellenelement ohne Bildlauf-Prop rendert, jede negative Prüfung —
 * und nähme allen künftigen Konsumenten still waagerechten Bildlauf, stehende Kopfzeile und
 * fixierte Kennungsspalte. Eine reine Verbotsliste kann das nicht sehen.
 *
 * ── HÄLFTE 2: die Konsumenten, ABGELEITET statt handgepflegt ────────────────────
 *
 * Die Entscheidung (§8) verlangt ein handgepflegtes Inventar mit `toHaveLength(n)`. Das ist
 * hier bewusst NICHT umgesetzt, und zwar aus zwei Gründen:
 *
 * 1. Bei Lieferung ist n = **0** — dieses Bündel liefert `Datensicht.tsx` mit NULL
 *    Konsumenten (alle liegen in B3/AP3/AP6/AP7). Ein auf 0 gepinntes Inventar bewiese
 *    nichts, und es wäre auf Dauer die zweite Wahrheit neben dem Code.
 * 2. Jedes Folgebündel müsste dieselbe Datei editieren — genau die Kollision, die für
 *    `katalogTabelle.guard.test.ts` einen benannten Eigentümer nötig gemacht hat.
 *
 * Die Konsumentenmenge wird deshalb aus der Marke `<Datensicht` ERSCHNÜFFELT. Die
 * Falsch-Positiv-Sorge, die das 13er-Inventar von `katalogTabelle.guard.test.ts`
 * handgepflegt macht („Modals, Listen, Untertabellen"), existiert hier nicht: die Menge ist
 * durch das Vorkommen der Marke definiert, nicht durch eine Einschätzung.
 *
 * ── WAS BÜNDEL V FÜLLT ──────────────────────────────────────────────────────────
 *
 * Handgepflegt bleiben allein die drei SEMANTISCHEN Ausnahmemengen unten
 * ({@link KARTEN_EIGENBAU}, {@link NUR_KARTE}, {@link NUR_TABELLE}). Alle drei sind bei
 * Lieferung leer und mit `toHaveLength(0)` gepinnt; **Bündel V füllt sie**, sobald die
 * Zielmodule umgebaut sind. Wer eine Datei einträgt, ohne sie umzubauen, fällt am
 * Anwesenheits-Gegentest auf — ein toter Eintrag wird gemeldet, nicht geduldet.
 *
 * ── WIE ER SEINE EIGENE PROSA NICHT MITZÄHLT — dreifach ─────────────────────────
 *
 * Zweifach ist im Vorläuferpaket zweimal gerissen, deshalb drei Verteidigungen:
 * 1. **Kommentar-Stripper mit Blockzustand über Zeilengrenzen** vor jeder VERBOTS-Zählung,
 *    plus ein Selbstbeweis, dass eine verbotene Form im Kommentar genau 0 Treffer liefert.
 * 2. **Die verbotenen Marken stehen in den gescannten Dateien nirgends als Prosa.** Der
 *    Dateikopf von `Datensicht.tsx` umschreibt sie durchgehend („kein Bildlauf-Prop", „die
 *    Kartenform ist `Liste`, nicht …"). Wer den Kopf ergänzt, schreibt keine Marke aus.
 * 3. **Der Guard scannt sich selbst nicht** — Testdateien sind aus allen Mengen ausgenommen.
 *
 * Der Kommentar-Stripper ist aus `theme/gate5.guard.test.ts` BEWUSST kopiert statt
 * importiert: ein Import aus einer anderen `*.test.ts` registriert deren `describe`-Blöcke
 * ein zweites Mal.
 *
 * ── WAS DER GUARD NICHT SIEHT, und das ist Teil des Vertrags ────────────────────
 *
 * · **Ob hinter einem Slot-Schlüssel überhaupt eine Spalte steht.** Das kann nur
 *   `pruefeKartenplan` zur Laufzeit und `tsc` bei intaktem `const K`.
 * · **Einen Konsumenten, der gar nichts von `Datensicht` weiß** — eine neue Einsatzliste,
 *   die wieder ein rohes antd-Tabellenelement einbindet, fällt hier nicht auf. Dagegen
 *   steht das Inventar in `katalogTabelle.guard.test.ts`, nicht dieser Guard.
 * · **Jede Aussage über Layout.** jsdom rechnet keines (`vite.config.ts`, `css: false`);
 *   Trefflächen, Überlauf und Fokusverdeckung gehören nach `frontend/e2e/`.
 * · **Dynamisch zusammengesetzte Bezeichner.** Wie in `useViewport.guard.test.ts` bewusst
 *   nicht abgedeckt.
 */

/** Wurzel des Scans: `frontend/src`, über `process.cwd()` aufgelöst (siehe gate5.guard). */
const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'components', 'Datensicht.tsx'))) return pfad;
  }
  throw new Error(`Datensicht-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

const PRIMITIV = '/src/components/Datensicht.tsx';
const ENDUNGEN = /\.(ts|tsx)$/;

/**
 * Dateien, die `art: 'eigen'` im Kartenplan setzen dürfen.
 *
 * Am Tag 1 LEER, und das ist der Unterschied zu Entwurf 2, dessen Ausnahme schon am ersten
 * Tag belegt war und über das Band auf etwa fünf gewachsen wäre. Die UHS-Zeitleiste läuft
 * über den Plan-Modus, weil `Liste` mit ihren Trennlinien bereits die Struktur von
 * `personen/PersonVerlauf.tsx` liefert. → Bündel V füllt, falls überhaupt.
 */
const KARTEN_EIGENBAU: string[] = [];

/**
 * Dateien, die `form="karte"` tragen MÜSSEN — Module, die heute schon kartenbasiert gelesen
 * werden (Befehle, Lageberichte). Dort ist die Tabelle der Befund, nicht der Zielzustand.
 * → Bündel V füllt (AP7: `auftraege/BefehlListe.tsx`, `pages/LageberichtePage.tsx`).
 */
const NUR_KARTE: string[] = [];

/**
 * Dateien, die `form="tabelle"` tragen MÜSSEN — Vergleichsflächen, die Kriterium 14
 * ausdrücklich nicht in Karten auflösen darf.
 * → Bündel V füllt (AP6: `pages/KraefteuebersichtPage.tsx`).
 *
 * WARUM DIESE ZWEI LISTEN ÜBERHAUPT: eine Datei mit `form="karte"` bleibt bei `<Table` = 0
 * grün, AUCH wenn sie eine Tabelle rendert — das Tabellenelement liegt in
 * `KatalogTabelle.tsx`. Die Verbotsmarke allein kann die Formwahl also nicht prüfen; nur die
 * Anwesenheit des Literals kann es.
 */
const NUR_TABELLE: string[] = [];

/** Alle Quelldateien als Rohtext, Pfad relativ zu `src/` (führendes `/src/…`). */
function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (ENDUNGEN.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/**
 * Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen.
 * Kopie aus `theme/gate5.guard.test.ts` — Begründung im Dateikopf.
 */
function ohneKommentare(inhalt: string): string {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of inhalt.split('\n')) {
    let rest = roh;
    let sichtbar = '';
    while (rest.length > 0) {
      if (imBlock) {
        const ende = rest.indexOf('*/');
        if (ende === -1) break;
        imBlock = false;
        rest = rest.slice(ende + 2);
        continue;
      }
      const block = rest.indexOf('/*');
      const einzeilig = rest.indexOf('//');
      if (block === -1 && einzeilig === -1) {
        sichtbar += rest;
        break;
      }
      if (einzeilig !== -1 && (block === -1 || einzeilig < block)) {
        sichtbar += rest.slice(0, einzeilig);
        break;
      }
      sichtbar += rest.slice(0, block);
      rest = rest.slice(block + 2);
      imBlock = true;
    }
    zeilen.push(sichtbar);
  }
  return zeilen.join('\n');
}

/** Öffnendes JSX-Element eines Namens — `<Name` gefolgt von Leerraum, `>` oder Generik. */
function elementMuster(name: string): RegExp {
  return new RegExp(`<${name}(?=[\\s/>{<])`, 'g');
}

function treffer(text: string, muster: RegExp): number {
  return text.match(muster)?.length ?? 0;
}

function istTest(pfad: string): boolean {
  return /\.test\.[jt]sx?$/.test(pfad) || /\.generated\.[jt]sx?$/.test(pfad);
}

/** Verbotene Formen im Primitiv, je mit Grund für die Fehlermeldung. */
const VERBOTEN_IM_PRIMITIV: readonly { muster: RegExp; grund: string }[] = [
  { muster: elementMuster('Table'), grund: 'keine zweite Tabellenwahrheit — über KatalogTabelle rendern' },
  { muster: /\bscroll=\{\{/g, grund: 'der waagerechte Bildlauf gehört KatalogTabelle, nicht hierher' },
  {
    muster: elementMuster('Card'),
    grund: 'die Kartenform ist Liste/ListenEintrag — ein Rahmen doppelt die li-Trennlinie',
  },
  { muster: /size="small"/g, grund: 'neue Klein-Varianten auf interaktiven Elementen sind verboten' },
  { muster: /matchMedia|\buseBreakpoint\b/g, grund: 'die Breitenfrage läuft über useViewport' },
];

/**
 * Die Anwesenheitsmarken der schriftlichen Begründung.
 *
 * WICHTIG: sie werden am ROHTEXT gemessen, nicht am kommentarfreien — sie STEHEN im
 * Dateikopf, also in einem Kommentar. Und Anwesenheitsprüfungen sind hier bewusst gewählt:
 * eine solche Marke kann ihr eigenes Gate nicht auslösen, im Gegensatz zu einer Verbotszählung.
 */
const BEGRUENDUNG = ['KARTEN-AUSNAHME', 'TRENNLINIE'];

/** Verbotene Formen je Konsumentendatei. */
const VERBOTEN_BEIM_KONSUMENTEN: readonly { muster: RegExp; grund: string }[] = [
  { muster: elementMuster('Table'), grund: 'die Tabelle kommt aus Datensicht/KatalogTabelle' },
  { muster: /\bscroll=\{\{/g, grund: 'der Bildlauf gehört dem Primitiv' },
  { muster: /\bsorter:/g, grund: 'Sortierung läuft über sortWert, nicht über antds Haken' },
  { muster: /\bfilters:/g, grund: 'Filter laufen über filter: { werte, trifft }' },
  { muster: /\bresponsive:/g, grund: 'Spaltenbreiten laufen über abBreite (sonst lügt der Zähler)' },
];

/**
 * Beide Hälften in EINER Befundliste. Exportiert und rein, damit die Selbstbeweise sie ohne
 * Dateisystem prüfen können — Bauform aus `useViewport.guard.test.ts`.
 */
export function befunde(
  dateien: Record<string, string>,
  ausnahmen: { eigenbau: readonly string[]; nurKarte: readonly string[]; nurTabelle: readonly string[] },
): string[] {
  const gefunden: string[] = [];
  const roh = dateien[PRIMITIV];

  // ── Hälfte 1: das Primitiv ────────────────────────────────────────────────────────
  if (roh == null) {
    gefunden.push(`${PRIMITIV} fehlt — das Primitiv ist die Grundlage dieses Guards.`);
  } else {
    const rein = ohneKommentare(roh);
    if (treffer(rein, elementMuster('KatalogTabelle')) < 1) {
      gefunden.push(
        `${PRIMITIV}: die tragende Marke <KatalogTabelle fehlt — ohne sie besteht ein ` +
          'Primitiv mit rohem Tabellenelement jede negative Prüfung und nimmt allen ' +
          'Konsumenten still Bildlauf, Kopfzeile und fixierte Kennung.',
      );
    }
    for (const { muster, grund } of VERBOTEN_IM_PRIMITIV) {
      const anzahl = treffer(rein, muster);
      if (anzahl > 0) gefunden.push(`${PRIMITIV}: ${anzahl}× ${muster.source} — ${grund}`);
    }
    for (const marke of BEGRUENDUNG) {
      // Am ROHTEXT: die Begründung steht im Dateikopf und damit in einem Kommentar.
      if (!roh.includes(marke)) {
        gefunden.push(
          `${PRIMITIV}: die schriftliche Begründung "${marke}" fehlt — die Karten-Ausnahme ` +
            'ist begründungspflichtig (A1, Festlegung 2).',
        );
      }
    }
  }

  // ── Hälfte 2: die abgeleiteten Konsumenten ────────────────────────────────────────
  const konsumenten: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (pfad === PRIMITIV || istTest(pfad)) continue;
    const rein = ohneKommentare(inhalt);
    if (treffer(rein, elementMuster('Datensicht')) < 1) {
      // Kein Konsument. Ein `art: 'eigen'` ohne Sicht wäre trotzdem ein Verstoß — geprüft unten.
      if (/\bart:\s*'eigen'/.test(rein) && !ausnahmen.eigenbau.includes(pfad)) {
        gefunden.push(`${pfad}: art: 'eigen' ohne Eintrag in KARTEN_EIGENBAU.`);
      }
      continue;
    }
    konsumenten.push(pfad);

    for (const { muster, grund } of VERBOTEN_BEIM_KONSUMENTEN) {
      const anzahl = treffer(rein, muster);
      if (anzahl > 0) gefunden.push(`${pfad}: ${anzahl}× ${muster.source} — ${grund}`);
    }
    // Schließt das `const K`-Widening: eine annotierte Spaltenliste weitet K auf `string`
    // und der Kartenplan nimmt danach jeden Tippfehler an. Der Typ kann das nicht sehen.
    if (!/\bspaltenFuer\b/.test(rein)) {
      gefunden.push(
        `${pfad}: die Marke spaltenFuer fehlt — eine annotierte Spaltenliste weitet die ` +
          'Schlüsselliterale auf string, und der Kartenplan nimmt danach jeden Tippfehler an.',
      );
    }
    if (/\bart:\s*'eigen'/.test(rein) && !ausnahmen.eigenbau.includes(pfad)) {
      gefunden.push(`${pfad}: art: 'eigen' ohne Eintrag in KARTEN_EIGENBAU.`);
    }
    if (ausnahmen.nurKarte.includes(pfad) && !/form="karte"/.test(rein)) {
      gefunden.push(`${pfad}: steht in NUR_KARTE, trägt aber kein form="karte".`);
    }
    if (ausnahmen.nurTabelle.includes(pfad) && !/form="tabelle"/.test(rein)) {
      gefunden.push(`${pfad}: steht in NUR_TABELLE, trägt aber kein form="tabelle".`);
    }
  }

  // Tote Ausnahmeeinträge melden — sonst veraltet die Liste still, wie in
  // `useViewport.guard.test.ts` begründet.
  for (const [name, liste] of [
    ['KARTEN_EIGENBAU', ausnahmen.eigenbau],
    ['NUR_KARTE', ausnahmen.nurKarte],
    ['NUR_TABELLE', ausnahmen.nurTabelle],
  ] as const) {
    for (const eintrag of liste) {
      if (dateien[eintrag] == null) gefunden.push(`tote Ausnahme in ${name}: ${eintrag}`);
      else if (name !== 'KARTEN_EIGENBAU' && !konsumenten.includes(eintrag)) {
        gefunden.push(`tote Ausnahme in ${name}: ${eintrag} ist kein Datensicht-Konsument.`);
      }
    }
  }
  return gefunden;
}

/** Die abgeleitete Konsumentenmenge — für den Sichtbarkeits-Test unten. */
export function konsumentenVon(dateien: Record<string, string>): string[] {
  return Object.entries(dateien)
    .filter(
      ([pfad, inhalt]) =>
        pfad !== PRIMITIV &&
        !istTest(pfad) &&
        treffer(ohneKommentare(inhalt), elementMuster('Datensicht')) >= 1,
    )
    .map(([pfad]) => pfad)
    .sort();
}

const dateien = lieseQuellen(SRC);
const AUSNAHMEN = {
  eigenbau: KARTEN_EIGENBAU,
  nurKarte: NUR_KARTE,
  nurTabelle: NUR_TABELLE,
};

describe('Datensicht-Guard (LFH-330 · B2)', () => {
  it('das Primitiv und alle abgeleiteten Konsumenten halten den Vertrag', () => {
    expect(
      befunde(dateien, AUSNAHMEN),
      'Der Tabellenzweig läuft über KatalogTabelle, Sortierung über sortWert, Filter über ' +
        'filter: { werte, trifft }, Spaltenbreiten über abBreite — und die Spaltenliste ' +
        'immer durch spaltenFuer<T>(), nie annotiert.',
    ).toEqual([]);
  });

  it('die drei semantischen Ausnahmemengen sind bei Lieferung leer (Bündel V füllt sie)', () => {
    // Auf 0 gepinnt, nicht weil 0 ein Ziel ist, sondern weil dieses Bündel NULL Konsumenten
    // liefert. Wer einträgt, ohne umzubauen, fällt am Anwesenheits-Gegentest oben auf.
    expect(KARTEN_EIGENBAU).toHaveLength(0);
    expect(NUR_KARTE).toHaveLength(0);
    expect(NUR_TABELLE).toHaveLength(0);
  });

  it('Sentinel: der Scan sieht das Primitiv und mehr als 200 Dateien', () => {
    // Ohne diesen Fall wäre ein kaputtes Scan-Muster (falsche Wurzel, falsche Endung) still
    // grün — der Guard fände dann schlicht nichts mehr und meldete Erfolg.
    expect(Object.keys(dateien).length).toBeGreaterThan(200);
    expect(dateien[PRIMITIV] ?? '').not.toBe('');
    expect(dateien[PRIMITIV]).toContain('KatalogTabelle');
  });

  it('bei Lieferung gibt es NULL Konsumenten — und das ist eine Aussage, keine Lücke', () => {
    /**
     * Dieses Bündel liefert das Primitiv ohne Aufrufstelle: die API ist gegen keine reale
     * Nutzung validiert, und die Aufrufbeispiele der Entscheidung sind ungeprüfter Text.
     * Der Fall steht hier, damit dieser Umstand SICHTBAR ist statt implizit — und er fällt
     * von selbst, sobald das erste Konsumentenbündel landet. Dann ist das Anpassen dieser
     * Zahl der Moment, in dem jemand die Ausnahmemengen oben nachzieht.
     */
    expect(konsumentenVon(dateien)).toEqual([]);
  });

  it('Selbstbeweis: fehlende tragende Marke UND jede Verbotsform werden gemeldet', () => {
    const nurRohesElement = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <Table dataSource={x} />;',
    };
    const gemeldet = befunde(nurRohesElement, {
      eigenbau: [],
      nurKarte: [],
      nurTabelle: [],
    });
    expect(gemeldet.some((b) => b.includes('<KatalogTabelle fehlt'))).toBe(true);
    expect(gemeldet.some((b) => b.includes('keine zweite Tabellenwahrheit'))).toBe(true);
  });

  it('Selbstbeweis: die Begründungsmarken werden verlangt', () => {
    const ohneBegruendung = { [PRIMITIV]: 'const a = <KatalogTabelle columns={c} />;' };
    const gemeldet = befunde(ohneBegruendung, { eigenbau: [], nurKarte: [], nurTabelle: [] });
    expect(gemeldet.filter((b) => b.includes('schriftliche Begründung'))).toHaveLength(2);
  });

  it('Selbstbeweis: ein Konsument ohne spaltenFuer und mit antds Haken fällt auf', () => {
    const baum = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <KatalogTabelle columns={c} />;',
      '/src/pages/Schlampig.tsx': [
        'const spalten: readonly DatensichtSpalte<P>[] = [',
        "  { key: 'a', title: 'A', sorter: (x, y) => 0, filters: [], responsive: ['lg'] },",
        '];',
        'const x = <Datensicht spalten={spalten} />;',
        'const y = <Table dataSource={d} scroll={{ x: 1 }} />;',
      ].join('\n'),
    };
    const gemeldet = befunde(baum, { eigenbau: [], nurKarte: [], nurTabelle: [] });
    const eigene = gemeldet.filter((b) => b.startsWith('/src/pages/Schlampig.tsx'));
    expect(eigene).toHaveLength(6);
    expect(eigene.some((b) => b.includes('spaltenFuer'))).toBe(true);
  });

  it('Selbstbeweis: art eigen ohne Eintrag fällt auf, mit Eintrag nicht', () => {
    const zeile = "const p = { art: 'eigen', render: (k) => null };";
    const baum = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <KatalogTabelle columns={c} />;',
      '/src/pages/Eigen.tsx': `${zeile}\nconst x = <Datensicht spaltenFuer />;`,
    };
    expect(
      befunde(baum, { eigenbau: [], nurKarte: [], nurTabelle: [] }).some((b) =>
        b.includes("art: 'eigen' ohne Eintrag"),
      ),
    ).toBe(true);
    expect(
      befunde(baum, { eigenbau: ['/src/pages/Eigen.tsx'], nurKarte: [], nurTabelle: [] }),
    ).toEqual([]);
  });

  it('Selbstbeweis: eine Formliste ohne das passende Literal fällt auf', () => {
    // Der Grund für diese Liste: eine Datei mit form="karte" bleibt bei <Table = 0 grün,
    // AUCH wenn sie eine Tabelle rendert — das Element liegt in KatalogTabelle.tsx.
    const baum = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <KatalogTabelle columns={c} />;',
      '/src/pages/Befehle.tsx': 'const x = <Datensicht spaltenFuer form="auto" />;',
    };
    const gemeldet = befunde(baum, {
      eigenbau: [],
      nurKarte: ['/src/pages/Befehle.tsx'],
      nurTabelle: [],
    });
    expect(gemeldet).toEqual(['/src/pages/Befehle.tsx: steht in NUR_KARTE, trägt aber kein form="karte".']);
  });

  it('Selbstbeweis: tote Ausnahmeeinträge werden gemeldet', () => {
    const baum = { [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\n<KatalogTabelle columns={c} />' };
    expect(
      befunde(baum, { eigenbau: [], nurKarte: ['/src/pages/Weg.tsx'], nurTabelle: [] }),
    ).toEqual(['tote Ausnahme in NUR_KARTE: /src/pages/Weg.tsx']);
  });

  it('Selbstbeweis: Kommentar-Fundstellen zählen nicht, auch im Block über Zeilen', () => {
    const baum = {
      [PRIMITIV]: [
        '/* KARTEN-AUSNAHME und TRENNLINIE stehen hier, im Kommentar',
        '   und hier erwähne ich <Table und scroll={{ x }} und <Card',
        '   und size="small" — nichts davon zählt */',
        '// auch hier nicht: <Table scroll={{ x: 1 }} matchMedia',
        'const a = <KatalogTabelle columns={c} />;',
      ].join('\n'),
    };
    // Die Verbotsformen liegen im Kommentar → 0 Befunde. Die BEGRÜNDUNG liegt ebenfalls im
    // Kommentar und wird trotzdem gefunden, weil sie am Rohtext gemessen wird — genau diese
    // Asymmetrie ist der Grund für die zwei Textquellen.
    expect(befunde(baum, { eigenbau: [], nurKarte: [], nurTabelle: [] })).toEqual([]);
  });

  it('Selbstbeweis: die generische Schreibweise wird richtig zugeordnet', () => {
    // `<KatalogTabelle<T>` darf NICHT als antd-Tabellenelement zählen (vor `Table` steht
    // kein `<`), `<Table<T>` MUSS es. Und `useMemo<TableColumnsType<T>>` ist keins von beiden.
    const probe = 'const a = <KatalogTabelle<Uhs> c={x} />; const t: TableColumnsType<Uhs> = [];';
    expect(treffer(probe, elementMuster('Table'))).toBe(0);
    expect(treffer(probe, elementMuster('KatalogTabelle'))).toBe(1);
    expect(treffer('const b = <Table<Uhs> rowKey="id" />;', elementMuster('Table'))).toBe(1);
    expect(treffer('useMemo<TableColumnsType<T>>(() => [])', elementMuster('Table'))).toBe(0);
  });
});
