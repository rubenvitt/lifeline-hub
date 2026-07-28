import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import Datensicht, {
  MAX_SEKUNDAER,
  TIEFE_DECKEL,
  effektiveDaten,
  etikettVon,
  gruppiere,
  pruefeKartenplan,
  sichtbareSpalten,
  spaltenFuer,
  zelle,
  type DatensichtSpalte,
  type Kartenplan,
} from './Datensicht';

/**
 * Prüfungen des Datensicht-Primitivs (LFH-330 · B2).
 *
 * Die reinen Funktionen werden DIREKT gerufen, ohne Rendern — dieselbe Bauform, die
 * `useViewport.guard.test.ts` mit seinem exportierten `verstoesse()` vorgibt. Für
 * `pruefeKartenplan` ist das nicht bloß bequem: über einen `console.warn`-Spion müsste man
 * die eigenen Meldungen gegen antds Fremdwarnungen abgrenzen, und jede neue
 * Bibliothekswarnung machte den Test flatterhaft.
 */

interface Fahrzeug {
  id: number;
  funkrufname: string;
  fahrzeugtyp: string | null;
  traeger: string | null;
  besatzung: number | null;
}

const F = (id: number, funkrufname: string, extra: Partial<Fahrzeug> = {}): Fahrzeug => ({
  id,
  funkrufname,
  fahrzeugtyp: 'LF',
  traeger: 'FW',
  besatzung: 6,
  ...extra,
});

const spalten = spaltenFuer<Fahrzeug>()([
  {
    key: 'funkrufname',
    title: 'Funkrufname',
    dataIndex: 'funkrufname',
    immerSichtbar: true,
    sortWert: (f) => f.funkrufname,
    suchText: (f) => f.funkrufname,
  },
  {
    key: 'typ',
    title: 'Typ',
    dataIndex: 'fahrzeugtyp',
    suchText: (f) => f.fahrzeugtyp,
    render: (t) => (t as string | null) ?? '—',
  },
  {
    key: 'traeger',
    title: 'Träger',
    dataIndex: 'traeger',
    filter: {
      werte: [
        { text: 'Feuerwehr', value: 'FW' },
        { text: 'Hilfsorganisation', value: 'HiOrg' },
      ],
      trifft: (f, w) => f.traeger === w,
    },
    render: (t) => (t as string | null) ?? '—',
  },
  {
    key: 'besatzung',
    title: 'Besatzung',
    abBreite: 'xl',
    sortWert: (f) => f.besatzung,
    render: (_t, f) => (f.besatzung == null ? '—' : `${f.besatzung} Kräfte`),
  },
]);

type FahrzeugKey = (typeof spalten)[number]['key'];

const karte: Kartenplan<Fahrzeug, FahrzeugKey> = {
  art: 'plan',
  titel: { spalte: 'funkrufname', ziel: (f) => `/einsaetze/1/fahrzeuge?fahrzeug=${f.id}` },
  sekundaer: ['typ', 'traeger', 'besatzung'],
};

const OHNE_FILTER = {} as Readonly<Record<string, readonly string[]>>;

// ────────────────────────────────────────────────────────────────────────────────────
// S6 · die reinen Funktionen
// ────────────────────────────────────────────────────────────────────────────────────

describe('zelle()', () => {
  it('packt eine RenderedCell auf children aus, ein React-Element aber NICHT', () => {
    /**
     * Antds `render` darf `{ props, children }` liefern (`@rc-component/table`
     * `interface.d.ts`, `RenderedCell`). React-Elemente tragen ebenfalls `props`.
     *
     * GEMESSEN, und es korrigiert die Formulierung der Entscheidung: die Reihenfolge
     * `isValidElement` vor `'children' in x` ist NICHT die trennende Eigenschaft — ein
     * React-Element hat gar kein `children` auf oberster Ebene (nur `props.children`),
     * beide Reihenfolgen verhalten sich gleich. Die Falle ist die ANDERE Erkennungsmarke:
     * wer die Zellbeschreibung an `'props' in x` erkennt, packt jedes `<Space>` aus und
     * liefert `undefined` — die Kartenzelle bleibt leer. Genau dagegen greift dieser Fall
     * (per Mutationsprobe belegt); `isValidElement` steht zuerst als zweite Sicherung.
     */
    const alsZelle: DatensichtSpalte<Fahrzeug> = {
      key: 'x',
      render: () => ({ props: { colSpan: 2 }, children: 'ausgepackt' }),
    };
    expect(zelle(alsZelle, F(1, 'A'), 0)).toBe('ausgepackt');

    const alsElement: DatensichtSpalte<Fahrzeug> = {
      key: 'y',
      render: () => <span data-testid="huelle">bleibt</span>,
    };
    const ergebnis = zelle(alsElement, F(1, 'A'), 0);
    expect(ergebnis).not.toBe('bleibt');
    renderMitProviders(<>{ergebnis}</>);
    expect(screen.getByTestId('huelle')).toHaveTextContent('bleibt');
  });

  it('löst ohne render den vollen dataIndex-Pfad auf', () => {
    interface Tief {
      meta: { kennung: string };
    }
    const tief: DatensichtSpalte<Tief> = { key: 'k', dataIndex: ['meta', 'kennung'] };
    expect(zelle(tief, { meta: { kennung: 'ALPHA' } }, 0)).toBe('ALPHA');

    const flach: DatensichtSpalte<Fahrzeug> = { key: 'k', dataIndex: 'funkrufname' };
    expect(zelle(flach, F(1, 'Florian 1'), 0)).toBe('Florian 1');
  });

  it('gibt dem render Wert, Zeile UND Index — in antds Reihenfolge', () => {
    const gesehen: unknown[] = [];
    const spalte: DatensichtSpalte<Fahrzeug> = {
      key: 'k',
      dataIndex: 'funkrufname',
      render: (wert, zeileArg, index) => {
        gesehen.push(wert, zeileArg, index);
        return 'ok';
      },
    };
    const zeileEins = F(7, 'Florian 7');
    zelle(spalte, zeileEins, 3);
    expect(gesehen).toEqual(['Florian 7', zeileEins, 3]);
  });
});

describe('etikettVon()', () => {
  it('nimmt etikett, sonst einen String-title', () => {
    expect(etikettVon({ key: 'a', etikett: 'Kennung', title: 'Funkrufname' })).toBe('Kennung');
    expect(etikettVon({ key: 'a', title: 'Funkrufname' })).toBe('Funkrufname');
  });

  it('ein Funktions-title ohne etikett ergibt undefined und genau eine DEV-Warnung', () => {
    // antds `title` ist `ReactNode | ((props) => ReactNode)` — ohne diesen Fall wäre die
    // Funktionsvariante unabgedeckt und `etikettVon` gäbe still ein Objekt als „Text".
    const spion = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(etikettVon({ key: 'a', title: () => <b>Funkrufname</b> })).toBeUndefined();
    expect(spion.mock.calls.filter((c) => String(c[0]).includes('[Datensicht]'))).toHaveLength(1);
    spion.mockRestore();
  });

  it('ein ReactNode-title ohne etikett ergibt ebenfalls undefined', () => {
    const spion = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(etikettVon({ key: 'a', title: <b>Fett</b> })).toBeUndefined();
    spion.mockRestore();
  });
});

describe('effektiveDaten()', () => {
  const daten = [F(1, 'Cäsar', { traeger: 'HiOrg' }), F(2, 'Anton'), F(3, 'Berta')];

  it('gibt im Baummodus die Rohdaten REFERENZGLEICH zurück', () => {
    /**
     * `toBe`, nicht `toEqual`: nur Referenzgleichheit belegt, dass gar nicht angefasst
     * wurde. Die Aggregate der Meldebild-Elternzeilen sind stromaufwärts über die
     * VOLLMENGE kumuliert (`kraefte/kraeftebild.ts`) — fiele hier eine Zeile weg, behielten
     * die Eltern Zahlen über nicht mehr sichtbare Kinder und lögen still.
     */
    const ergebnis = effektiveDaten({
      daten,
      spalten,
      sortierung: { spalte: 'funkrufname', richtung: 'auf' },
      suchbegriff: 'Anton',
      filterWerte: { traeger: ['FW'] },
      gruppen: { schluessel: (f) => f.traeger ?? 'ohne', etikett: (w) => w },
      baum: true,
    });
    expect(ergebnis).toBe(daten);
  });

  it('sortiert auf- und absteigend über sortWert', () => {
    const auf = effektiveDaten({
      daten,
      spalten,
      sortierung: { spalte: 'funkrufname', richtung: 'auf' },
      suchbegriff: '',
      filterWerte: OHNE_FILTER,
      baum: false,
    });
    expect(auf.map((f) => f.funkrufname)).toEqual(['Anton', 'Berta', 'Cäsar']);

    const ab = effektiveDaten({
      daten,
      spalten,
      sortierung: { spalte: 'funkrufname', richtung: 'ab' },
      suchbegriff: '',
      filterWerte: OHNE_FILTER,
      baum: false,
    });
    expect(ab.map((f) => f.funkrufname)).toEqual(['Cäsar', 'Berta', 'Anton']);
  });

  it('null und undefined landen HINTEN — in BEIDEN Richtungen', () => {
    // Ohne diese Zusicherung sortiert `undefined` je nach Vergleichsfunktion irgendwohin,
    // und „kein Wert" wandert bei einem Richtungswechsel an den Anfang der Liste.
    const mitLuecken = [
      F(1, 'A', { besatzung: 6 }),
      F(2, 'B', { besatzung: null }),
      F(3, 'C', { besatzung: 2 }),
    ];
    const auf = effektiveDaten({
      daten: mitLuecken,
      spalten,
      sortierung: { spalte: 'besatzung', richtung: 'auf' },
      suchbegriff: '',
      filterWerte: OHNE_FILTER,
      baum: false,
    });
    expect(auf.map((f) => f.funkrufname)).toEqual(['C', 'A', 'B']);

    const ab = effektiveDaten({
      daten: mitLuecken,
      spalten,
      sortierung: { spalte: 'besatzung', richtung: 'ab' },
      suchbegriff: '',
      filterWerte: OHNE_FILTER,
      baum: false,
    });
    expect(ab.map((f) => f.funkrufname)).toEqual(['A', 'C', 'B']);
  });

  it('null-Sortierung lässt die Serverordnung unangetastet', () => {
    const ergebnis = effektiveDaten({
      daten,
      spalten,
      sortierung: null,
      suchbegriff: '',
      filterWerte: OHNE_FILTER,
      baum: false,
    });
    expect(ergebnis.map((f) => f.funkrufname)).toEqual(['Cäsar', 'Anton', 'Berta']);
  });

  it('die Gruppenachse ist die FÜHRENDE Sortierachse', () => {
    // Sonst lägen die Gruppen nicht zusammenhängend, und der Tabellenzweig — der keine
    // synthetischen Gruppenzeilen bekommt — zeigte eine Gruppierung, die man nicht sieht.
    const ergebnis = effektiveDaten({
      daten,
      spalten,
      sortierung: { spalte: 'funkrufname', richtung: 'auf' },
      suchbegriff: '',
      filterWerte: OHNE_FILTER,
      gruppen: {
        schluessel: (f) => f.traeger ?? 'ohne',
        etikett: (w) => w,
        reihenfolge: ['HiOrg', 'FW'],
      },
      baum: false,
    });
    expect(ergebnis.map((f) => f.funkrufname)).toEqual(['Cäsar', 'Anton', 'Berta']);
  });

  it('die Suche trifft NUR Spalten mit suchText', () => {
    // `traeger` hat keinen `suchText`. Ohne diesen Fall wäre „Freitextsuche über alle
    // Spalten mit suchText" eine Behauptung statt einer Zusicherung.
    const nachTyp = effektiveDaten({
      daten,
      spalten,
      sortierung: null,
      suchbegriff: 'LF',
      filterWerte: OHNE_FILTER,
      baum: false,
    });
    expect(nachTyp).toHaveLength(3);

    const nachTraeger = effektiveDaten({
      daten,
      spalten,
      sortierung: null,
      suchbegriff: 'HiOrg',
      filterWerte: OHNE_FILTER,
      baum: false,
    });
    expect(nachTraeger).toHaveLength(0);
  });

  it('Spaltenfilter greifen über das eigene Prädikat, mehrere Werte als ODER', () => {
    const nurFw = effektiveDaten({
      daten,
      spalten,
      sortierung: null,
      suchbegriff: '',
      filterWerte: { traeger: ['FW'] },
      baum: false,
    });
    expect(nurFw.map((f) => f.funkrufname)).toEqual(['Anton', 'Berta']);

    const beide = effektiveDaten({
      daten,
      spalten,
      sortierung: null,
      suchbegriff: '',
      filterWerte: { traeger: ['FW', 'HiOrg'] },
      baum: false,
    });
    expect(beide).toHaveLength(3);

    const leereAuswahl = effektiveDaten({
      daten,
      spalten,
      sortierung: null,
      suchbegriff: '',
      filterWerte: { traeger: [] },
      baum: false,
    });
    expect(leereAuswahl).toHaveLength(3);
  });
});

describe('gruppiere()', () => {
  const daten = [
    F(1, 'A', { traeger: 'HiOrg' }),
    F(2, 'B', { traeger: 'FW' }),
    F(3, 'C', { traeger: 'Bundeswehr' }),
    F(4, 'D', { traeger: 'FW' }),
  ];
  const achse = {
    schluessel: (f: Fahrzeug) => f.traeger ?? 'ohne',
    etikett: (w: string) => `Träger ${w}`,
    reihenfolge: ['FW', 'HiOrg', 'THW'],
  };

  it('die feste Reihenfolge gewinnt, Unbekanntes hängt in Antreffreihenfolge hinten an', () => {
    const gruppen = gruppiere(daten, achse);
    expect(gruppen.map((g) => g.wert)).toEqual(['FW', 'HiOrg', 'Bundeswehr']);
    expect(gruppen.map((g) => g.zeilen.length)).toEqual([2, 1, 1]);
    expect(gruppen[0].etikett).toBe('Träger FW');
  });

  it('eine leere Gruppe aus der Reihenfolge erscheint NICHT', () => {
    // `'THW'` steht in der Reihenfolge, hat aber keine Zeile. Ein leerer Gruppenkopf mit
    // „· 0" wäre Rauschen und würde die Zählerstreifen der Werkzeugzeile aufblähen.
    expect(gruppiere(daten, achse).map((g) => g.wert)).not.toContain('THW');
  });
});

describe('sichtbareSpalten()', () => {
  const immerBreit = () => true;

  it('Index 0 ist NIE entfernbar — nicht per Hand, nicht per Breite, nicht per beides', () => {
    /**
     * `KatalogTabelle` fixiert, was als Spalte 0 ANKOMMT, nicht eine benannte. Fällt Spalte
     * 0 weg, wird still eine ANDERE Spalte die fixierte Kennung: kein Fehler, kein roter
     * Test, nur eine falsche Fixierung. `immerSichtbar` allein genügt dafür nicht — es ist
     * ein Flag, das jemand vergisst. Die Invariante gehört hierher.
     */
    const perHand = sichtbareSpalten({
      spalten,
      verborgen: new Set<FahrzeugKey>(['funkrufname']),
      abBreite: immerBreit,
    });
    expect(perHand.spalten[0].key).toBe('funkrufname');
    expect(perHand.anzahlVerborgen).toBe(0);

    const mitBreite = spaltenFuer<Fahrzeug>()([
      { key: 'kennung', title: 'Kennung', dataIndex: 'funkrufname', abBreite: 'xxl' },
      { key: 'typ', title: 'Typ', dataIndex: 'fahrzeugtyp' },
    ]);
    const perBreite = sichtbareSpalten({
      spalten: mitBreite,
      verborgen: new Set<'kennung' | 'typ'>(['kennung']),
      abBreite: () => false,
    });
    expect(perBreite.spalten.map((s) => s.key)).toEqual(['kennung', 'typ']);
    expect(perBreite.anzahlVerborgen).toBe(0);
  });

  it('zählt Handauswahl UND abBreite in EINEM Zähler', () => {
    /**
     * Ein Zähler, der „0 ausgeblendet" meldet, während zwei Spalten fehlen, verfehlt genau
     * das Kriterium (14), für das er existiert. Deshalb sind antds `responsive` und `hidden`
     * am Spaltentyp amputiert — sie verbärgen Spalten, die dieser Zähler nicht kennt.
     */
    const ergebnis = sichtbareSpalten({
      spalten,
      verborgen: new Set<FahrzeugKey>(['traeger']),
      // `besatzung` trägt `abBreite: 'xl'` und fällt damit weg
      abBreite: (punkt) => punkt !== 'xl',
    });
    expect(ergebnis.spalten.map((s) => s.key)).toEqual(['funkrufname', 'typ']);
    expect(ergebnis.anzahlVerborgen).toBe(2);
  });

  it('eine per Hand UND per Breite verborgene Spalte wird nur EINMAL gezählt', () => {
    const ergebnis = sichtbareSpalten({
      spalten,
      verborgen: new Set<FahrzeugKey>(['besatzung']),
      abBreite: (punkt) => punkt !== 'xl',
    });
    expect(ergebnis.anzahlVerborgen).toBe(1);
  });

  it('immerSichtbar schützt auch eine Spalte, die nicht an Position 0 steht', () => {
    const mitAktion = spaltenFuer<Fahrzeug>()([
      { key: 'kennung', title: 'Kennung', dataIndex: 'funkrufname' },
      { key: 'aktionen', title: 'Aktionen', immerSichtbar: true, render: () => 'Entfernen' },
    ]);
    const ergebnis = sichtbareSpalten({
      spalten: mitAktion,
      verborgen: new Set<'kennung' | 'aktionen'>(['aktionen']),
      abBreite: immerBreit,
    });
    expect(ergebnis.spalten.map((s) => s.key)).toEqual(['kennung', 'aktionen']);
    expect(ergebnis.anzahlVerborgen).toBe(0);
  });
});

describe('pruefeKartenplan()', () => {
  const meldung = (befunde: string[], teil: string) =>
    befunde.filter((b) => b.toLowerCase().includes(teil.toLowerCase()));

  it('ein intakter Plan liefert eine LEERE Liste', () => {
    expect(pruefeKartenplan({ spalten, karte }, 'Fahrzeuge')).toEqual([]);
  });

  it('meldet einen Titel-Slot ohne Spalte', () => {
    // Das ist der Fang für das `const K`-Widening, das der Typ NICHT schließt: wer die
    // Spaltenliste als `readonly DatensichtSpalte<Fahrzeug>[]` annotiert statt sie durch
    // `spaltenFuer` zu führen, weitet K auf `string` und der Plan nimmt jeden Tippfehler an.
    const befunde = pruefeKartenplan(
      { spalten, karte: { ...karte, titel: { spalte: 'funkrufnaem' as FahrzeugKey } } },
      'Fahrzeuge',
    );
    expect(meldung(befunde, 'funkrufnaem')).toHaveLength(1);
  });

  it('meldet einen sekundaer-Slot ohne Spalte', () => {
    const befunde = pruefeKartenplan(
      { spalten, karte: { ...karte, sekundaer: ['typ', 'gibtsNicht' as FahrzeugKey] } },
      'Fahrzeuge',
    );
    expect(meldung(befunde, 'gibtsNicht')).toHaveLength(1);
  });

  it('meldet doppelte Spaltenschlüssel', () => {
    const doppelt = [...spalten, { key: 'typ' as FahrzeugKey, title: 'Typ nochmal' }];
    expect(meldung(pruefeKartenplan({ spalten: doppelt, karte }, 'Fahrzeuge'), 'doppelt')).toHaveLength(1);
  });

  it('meldet eine sekundaer-Spalte ohne Etikett', () => {
    // Ohne Etikett hätte das Kartenfeld keine Beschriftung — die Karte zeigte einen Wert
    // ohne Bedeutung. Nur die Sekundärfelder brauchen es, der Titel steht für sich.
    const spion = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ohneEtikett = spaltenFuer<Fahrzeug>()([
      { key: 'funkrufname', title: 'Funkrufname', dataIndex: 'funkrufname' },
      { key: 'typ', title: () => <b>Typ</b>, dataIndex: 'fahrzeugtyp' },
    ]);
    const befunde = pruefeKartenplan(
      {
        spalten: ohneEtikett,
        karte: { art: 'plan', titel: { spalte: 'funkrufname' }, sekundaer: ['typ'] },
      },
      'Fahrzeuge',
    );
    expect(meldung(befunde, 'etikett')).toHaveLength(1);
    spion.mockRestore();
  });

  it('meldet suche und Spaltenfilter im Baummodus', () => {
    const baum = { kinder: 'kinder' as never, aufgeklappt: [], onAufgeklappt: () => {} };
    const befunde = pruefeKartenplan(
      { spalten, karte, baum, suche: { platzhalter: 'suchen' } },
      'Meldebild',
    );
    expect(meldung(befunde, 'suche')).toHaveLength(1);
    expect(meldung(befunde, 'filter')).toHaveLength(1);
  });

  it('meldet baum zusammen mit aufklappzeile und mit gruppen', () => {
    const baum = { kinder: 'kinder' as never, aufgeklappt: [], onAufgeklappt: () => {} };
    const ohneFilterSpalten = spalten.filter((s) => s.filter == null);
    const befunde = pruefeKartenplan(
      {
        spalten: ohneFilterSpalten,
        karte,
        baum,
        aufklappzeile: () => 'Besatzung',
        gruppen: { schluessel: () => 'a', etikett: (w) => w },
      },
      'Meldebild',
    );
    expect(meldung(befunde, 'aufklappzeile')).toHaveLength(1);
    expect(meldung(befunde, 'gruppen')).toHaveLength(1);
  });

  it('meldet eine Spaltengruppe mit sortWert', () => {
    // Eine Gruppe ist keine Blattspalte; ein `sortWert` daran wäre wirkungslos und die
    // Sortierauswahl zeigte einen Eintrag, der nichts tut.
    const gruppe = [
      { key: 'kennung' as FahrzeugKey, title: 'Kennung', dataIndex: 'funkrufname' },
      {
        key: 'gruppe' as FahrzeugKey,
        title: 'Gruppe',
        sortWert: () => 1,
        children: [{ key: 'a', title: 'A' }],
      },
    ] as unknown as readonly DatensichtSpalte<Fahrzeug, FahrzeugKey>[];
    const befunde = pruefeKartenplan(
      { spalten: gruppe, karte: { art: 'plan', titel: { spalte: 'kennung' as FahrzeugKey } } },
      'Fahrzeuge',
    );
    expect(meldung(befunde, 'gruppe')).toHaveLength(1);
  });
});

describe('Konstanten', () => {
  it('benennen die am Typ erzwungenen Obergrenzen', () => {
    expect(MAX_SEKUNDAER).toBe(3);
    expect(TIEFE_DECKEL).toBe(3);
  });
});

/**
 * Die Typgrenze — gepinnt im TYPECHECK, nicht zur Laufzeit.
 *
 * GEMESSEN und der Grund für `NoInfer<K>` an jeder K-Position außer `spalten`: ohne das
 * wird `K` aus dem Kartenplan MITINFERIERT. Ein Tippfehler weitet `K` dann einfach um sein
 * eigenes Literal (`'reg' | 'name' | 'regg'`), weil `DatensichtSpalte<T, K>` in `K`
 * kovariant ist — und die ganze Literalbewahrung, die `spaltenFuer` und `const K` kosten,
 * wäre wirkungslos. Ein Testlauf hätte das nie gezeigt.
 *
 * Diese Blöcke fallen NUR über `tsc --noEmit`. Wird `NoInfer` entfernt, greifen die
 * `@ts-expect-error`-Direktiven nicht mehr und TypeScript meldet sie als ungenutzt (TS2578)
 * — das Gate bricht also in beide Richtungen.
 */
describe('Typgrenzen (nur tsc)', () => {
  it('Slot-Tippfehler und der vierte Sekundärslot brechen den Typcheck', () => {
    const gut = <Datensicht bezeichnung="A" spalten={spalten} daten={DREI} zeilenSchluessel="id" karte={karte} />;

    const tippfehler = (
      <Datensicht
        bezeichnung="A"
        spalten={spalten}
        daten={DREI}
        zeilenSchluessel="id"
        // @ts-expect-error 'funkrufnaem' ist keine Spalte — das MUSS am Typ scheitern
        karte={{ art: 'plan', titel: { spalte: 'funkrufnaem' } }}
      />
    );

    const zuVieleFelder = (
      <Datensicht
        bezeichnung="A"
        spalten={spalten}
        daten={DREI}
        zeilenSchluessel="id"
        karte={{
          art: 'plan',
          titel: { spalte: 'funkrufname' },
          // @ts-expect-error vier Sekundärfelder sprengen den Tupeltyp (MAX_SEKUNDAER)
          sekundaer: ['typ', 'traeger', 'besatzung', 'typ'],
        }}
      />
    );

    const falscheSortierspalte = (
      <Datensicht
        bezeichnung="A"
        spalten={spalten}
        daten={DREI}
        zeilenSchluessel="id"
        karte={karte}
        // @ts-expect-error 'gibtsNicht' ist keine Spalte
        standardSortierung={{ spalte: 'gibtsNicht', richtung: 'auf' }}
      />
    );

    expect([gut, tippfehler, zuVieleFelder, falscheSortierspalte]).toHaveLength(4);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────
// S7 · die zwei Zweige
// ────────────────────────────────────────────────────────────────────────────────────

const DREI = [F(1, 'Florian 1', { traeger: 'FW' }), F(2, 'Rotkreuz 2', { traeger: 'HiOrg' }), F(3, 'Florian 3')];

function rendere(props: Partial<Parameters<typeof Datensicht<Fahrzeug, FahrzeugKey>>[0]> = {}) {
  return renderMitProviders(
    <Datensicht<Fahrzeug, FahrzeugKey>
      bezeichnung="Fahrzeuge im Einsatz"
      spalten={spalten}
      daten={DREI}
      zeilenSchluessel="id"
      karte={karte}
      {...props}
    />,
  );
}

const tabellen = (c: HTMLElement) => c.querySelectorAll('.ant-table');
const karten = (c: HTMLElement) => c.querySelectorAll('[data-lfh="datensicht-karte"]');

describe('Datensicht · Formachse', () => {
  it('bei 1024 px genau EIN Zweig: Tabelle, keine Karte', () => {
    /**
     * Die Gegenprobe zum Schmal-Fall ist Pflicht, nicht Zierde: ohne sie wäre der
     * Schmal-Test auch grün, wenn die Weiche bei JEDER Breite in den Kartenzweig kippt.
     * Die Lehre steht im Repo als Kommentar in `einsatz/EinsatzLayout.test.tsx`.
     */
    const { container } = rendere();
    expect(tabellen(container)).toHaveLength(1);
    expect(karten(container)).toHaveLength(0);
  });

  it('unter md genau EIN Zweig: Karten, keine Tabelle', () => {
    // `setzeViewportBreite` VOR dem Render: antds Beobachter ruft seinen Zuhörer beim
    // Abonnieren synchron auf und liest dabei nur `matches`. Und `abBreiteAus` liest
    // „unbekannt" als BREIT — eine nachträglich gesetzte Breite erreicht ihn nicht mehr.
    setzeViewportBreite(390);
    const { container } = rendere();
    expect(tabellen(container)).toHaveLength(0);
    expect(karten(container)).toHaveLength(3);
  });

  it('form="tabelle" bleibt bei 390 px eine Tabelle', () => {
    // Das Meldebild der Kräfteübersicht: Prüflisten-Kriterium 14 verbietet dort die
    // Auflösung in Karten ausdrücklich, das ist kein Ermessen.
    setzeViewportBreite(390);
    const { container } = rendere({ form: 'tabelle' });
    expect(tabellen(container)).toHaveLength(1);
    expect(karten(container)).toHaveLength(0);
  });

  it('form="karte" bleibt bei 1024 px eine Karte', () => {
    const { container } = rendere({ form: 'karte' });
    expect(tabellen(container)).toHaveLength(0);
    expect(karten(container)).toHaveLength(3);
  });

  it('trägt eine ansprechbare Region mit der Bezeichnung', () => {
    // `<section aria-label>` — ein nacktes `div` mit `aria-label` hat keine Rolle und
    // `getByRole('region')` griffe dort nicht.
    rendere();
    expect(screen.getByRole('region', { name: 'Fahrzeuge im Einsatz' })).toBeInTheDocument();
  });
});

describe('Datensicht · Kartenzweig', () => {
  it('die Titelzelle ist in BEIDEN Zweigen ein echter Link', () => {
    /**
     * `ListenEintrag` ist ein nacktes `<div onClick>` (kein `role`, kein `tabIndex`, kein
     * `onKeyDown`). Ein Zeilenklick darauf wäre maus-/tippgebunden und für die
     * Trefflächenmessung unsichtbar — das Tastaturziel der Zeile ist deshalb der Titel-Link.
     */
    setzeViewportBreite(390);
    const schmal = rendere();
    expect(schmal.getByRole('link', { name: 'Florian 1' })).toHaveAttribute(
      'href',
      '/einsaetze/1/fahrzeuge?fahrzeug=1',
    );
    schmal.unmount();

    setzeViewportBreite(1024);
    const breit = rendere();
    expect(breit.getByRole('link', { name: 'Florian 1' })).toBeInTheDocument();
  });

  it('zeigt höchstens drei Sekundärfelder, mit Etikett und Wert aus DERSELBEN Spalte', () => {
    setzeViewportBreite(390);
    const { container } = rendere();
    const felder = karten(container)[0].querySelectorAll('[data-lfh="datensicht-feld"]');
    expect(felder.length).toBeLessThanOrEqual(MAX_SEKUNDAER);
    expect(felder).toHaveLength(3);
    // Der Wert kommt aus dem `render` derselben Spalte — nicht aus dem Rohfeld.
    expect([...felder].map((f) => f.textContent)).toContain('Besatzung6 Kräfte');
  });

  it('genau eine Primäraktion, mit Rückfrage bei gesetzter bestaetigung', async () => {
    // Die drei Bestands-„Entfernen" hängen an einem `Popconfirm`. Ohne `bestaetigung`
    // feuerte die Aktion im Kartenzweig ohne Rückfrage — Prüflisten-Kriterium 4.
    setzeViewportBreite(390);
    const onKlick = vi.fn();
    const { container } = rendere({
      karte: { ...karte, aktion: { etikett: 'Entfernen', bestaetigung: 'Wirklich?', onKlick } },
    });
    const knoepfe = container.querySelectorAll('[data-lfh="datensicht-karte"] button');
    expect(knoepfe).toHaveLength(3);
    expect(knoepfe[0]).not.toHaveClass('ant-btn-dangerous');

    await userEvent.click(knoepfe[0]);
    expect(onKlick).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));
    expect(onKlick).toHaveBeenCalledWith(DREI[0]);
  });

  it('sichtbar() blendet die Aktion zeilenweise aus', () => {
    setzeViewportBreite(390);
    const { container } = rendere({
      karte: {
        ...karte,
        aktion: { etikett: 'Entfernen', onKlick: () => {}, sichtbar: (f) => f.id === 2 },
      },
    });
    expect(container.querySelectorAll('[data-lfh="datensicht-karte"] button')).toHaveLength(1);
  });

  it('der Statusslot rendert ein Etikett MIT Text, nicht nur eine Farbe', () => {
    // `label` ist am `StatusDarstellung`-Typ Pflichtfeld und damit der erzwungene zweite
    // Kanal (WCAG 1.4.1). Ein Slot, der nur eine Rolle liefert, bricht den Typcheck.
    setzeViewportBreite(390);
    rendere({ karte: { ...karte, status: () => ({ rolle: 'normal', label: 'verfügbar' }) } });
    expect(screen.getAllByText('verfügbar')).toHaveLength(3);
  });

  it('Gruppen erscheinen im Kartenzweig als Köpfe mit Zähler', () => {
    setzeViewportBreite(390);
    rendere({
      gruppen: {
        schluessel: (f) => f.traeger ?? 'ohne',
        etikett: (w) => (w === 'FW' ? 'Feuerwehr' : 'Hilfsorganisation'),
        reihenfolge: ['FW', 'HiOrg'],
      },
    });
    expect(screen.getByText('Feuerwehr · 2')).toBeInTheDocument();
    expect(screen.getByText('Hilfsorganisation · 1')).toBeInTheDocument();
  });

  it('leerText läuft über emptyText — es entsteht KEIN Empty-Knoten', () => {
    setzeViewportBreite(390);
    const { container } = rendere({ daten: [], leerText: 'Noch keine Fahrzeuge disponiert' });
    expect(screen.getByText('Noch keine Fahrzeuge disponiert')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
  });
});

describe('Datensicht · Tabellenzweig', () => {
  it('rendert durch KatalogTabelle: Scrollcontainer, stehende Kopfzeile, fixierte Kennung', () => {
    const { container } = rendere();
    expect(container.querySelector('.ant-table-sticky-holder')).not.toBeNull();
    const fixierte = container.querySelectorAll('th.ant-table-cell-fix-start');
    expect(fixierte).toHaveLength(1);
    expect(fixierte[0].textContent).toBe('Funkrufname');
  });

  it('blättert NICHT und bringt genau EIN Suchfeld mit', () => {
    /**
     * `Datensicht` gibt `KatalogTabelle` explizit `pagination={false}` und setzt dessen
     * `suche` NICHT — sonst blätterte die Tabelle unter der Zeilenschleuse weg, und das
     * Suchfeld des Primitivs stünde als zweites neben dem eigenen. Der Guard sieht das
     * nicht (er zählt nur `<KatalogTabelle` ≥ 1), deshalb steht es hier.
     */
    const viele = Array.from({ length: 60 }, (_, i) => F(i + 1, `Florian ${i + 1}`));
    const { container } = rendere({ daten: viele, suche: { platzhalter: 'Funkrufname' } });
    expect(container.querySelector('.ant-pagination')).toBeNull();
    expect(container.querySelectorAll('input[type="search"]')).toHaveLength(1);
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(60);
  });

  it('abBreite streicht die Spalte und der Schalter meldet den Zähler als TEXT', async () => {
    /**
     * Der Zähler steht als Text im Namen, NICHT als `Badge`: ein `count`-Badge rendert ohne
     * `color` auf `token.colorError` — Rot für einen Spaltenzähler bricht „Rot bedient
     * nichts" und Kriterium 7.
     */
    const { container } = rendere({ spaltenAusVoreinstellung: ['traeger'] });
    const kopfzellen = [...container.querySelectorAll('th.ant-table-cell')].map((z) => z.textContent);
    expect(kopfzellen).toEqual(['Funkrufname', 'Typ']);

    const schalter = screen.getByRole('button', { name: /Spalten · 2 ausgeblendet/ });
    expect(container.querySelector('.ant-badge-count')).toBeNull();

    await userEvent.click(schalter);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Träger' }));
    expect([...container.querySelectorAll('th.ant-table-cell')].map((z) => z.textContent)).toEqual([
      'Funkrufname',
      'Typ',
      'Träger',
    ]);
    expect(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ })).toBeInTheDocument();
  });

  it('Suche und Sortierung wirken auf die Zeilenmenge, nicht nur auf die Anzeige', async () => {
    const namen = (c: HTMLElement) =>
      [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

    const { container } = rendere({
      suche: { platzhalter: 'Funkrufname' },
      standardSortierung: { spalte: 'funkrufname', richtung: 'auf' },
    });
    expect(namen(container)).toEqual(['Florian 1', 'Florian 3', 'Rotkreuz 2']);

    // Sortiert wird im Primitiv; die Tabelle bekommt nur `sorter: true` für den Pfeil.
    // Antds Zyklus ist aufsteigend → absteigend → keine Sortierung; die dritte Stufe ist
    // hier deshalb wieder die Serverordnung, nicht ein erneutes Aufsteigend.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(namen(container)).toEqual(['Rotkreuz 2', 'Florian 3', 'Florian 1']);
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(namen(container)).toEqual(['Florian 1', 'Rotkreuz 2', 'Florian 3']);

    await userEvent.type(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'Rotkreuz');
    expect(namen(container)).toEqual(['Rotkreuz 2']);
  });

  it('kontrollierte Sortierung meldet nach außen und rendert die Vorgabe', async () => {
    // Sortierung wird von zwei Nachbartasks gelesen (B6-Sammelbanner, B7-Palette) und ist
    // Kandidat für ein späteres `?sort=` — deshalb hat sie eine kontrollierte Form.
    const onSortierung = vi.fn();
    const { container } = rendere({
      sortierung: { spalte: 'funkrufname', richtung: 'auf' },
      onSortierung,
    });
    expect([...container.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent)).toEqual([
      'Florian 1',
      'Florian 3',
      'Rotkreuz 2',
    ]);
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(onSortierung).toHaveBeenCalledWith({ spalte: 'funkrufname', richtung: 'ab' });

    // Kontrolliert heißt kontrolliert: ohne Zutun des Aufrufers bleibt die Anzeige stehen.
    expect([...container.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent)).toEqual([
      'Florian 1',
      'Florian 3',
      'Rotkreuz 2',
    ]);
  });

  it('Spaltenfilter stehen in der Werkzeugzeile und wirken auf die Zeilenmenge', async () => {
    // `filters`/`onFilter` sind am Spaltentyp amputiert, weil antd deren Zustand INTERN
    // hält — der Kartenzweig könnte ihn nicht lesen und zeigte still eine andere Menge.
    // Also steht der Filter in der Werkzeugzeile, nicht im Spaltentrichter.
    const { container } = rendere();
    expect(container.querySelector('.ant-table-filter-trigger')).toBeNull();

    await userEvent.click(screen.getByRole('combobox', { name: 'Träger' }));
    await userEvent.click(await screen.findByTitle('Feuerwehr'));
    expect([...container.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent)).toEqual([
      'Florian 1',
      'Florian 3',
    ]);
  });

  it('aufklappzeile läuft nur im Tabellenzweig', () => {
    const breit = rendere({ aufklappzeile: (f) => `Besatzung von ${f.funkrufname}` });
    expect(breit.container.querySelectorAll('.ant-table-row-expand-icon')).toHaveLength(3);
    breit.unmount();

    setzeViewportBreite(390);
    const schmal = rendere({ aufklappzeile: (f) => `Besatzung von ${f.funkrufname}` });
    expect(schmal.container.querySelectorAll('.ant-table-row-expand-icon')).toHaveLength(0);
    expect(schmal.queryByText('Besatzung von Florian 1')).toBeNull();
  });

  it('der Baum läuft über antds expandable, kontrolliert von außen', () => {
    interface Zeile {
      key: string;
      bezeichnung: string;
      kinder?: Zeile[];
    }
    const baumSpalten = spaltenFuer<Zeile>()([
      { key: 'bez', title: 'Bezeichnung', dataIndex: 'bezeichnung', immerSichtbar: true },
    ]);
    const daten: Zeile[] = [
      { key: 'a', bezeichnung: 'Abschnitt Nord', kinder: [{ key: 'a1', bezeichnung: 'Einheit 1' }] },
    ];
    const onAufgeklappt = vi.fn();
    const zu = renderMitProviders(
      <Datensicht<Zeile, 'bez'>
        bezeichnung="Meldebild"
        form="tabelle"
        spalten={baumSpalten}
        daten={daten}
        zeilenSchluessel="key"
        baum={{ kinder: 'kinder', aufgeklappt: [], onAufgeklappt }}
        karte={{ art: 'plan', titel: { spalte: 'bez' } }}
      />,
    );
    expect(zu.queryByText('Einheit 1')).toBeNull();
    zu.unmount();

    const auf = renderMitProviders(
      <Datensicht<Zeile, 'bez'>
        bezeichnung="Meldebild"
        form="tabelle"
        spalten={baumSpalten}
        daten={daten}
        zeilenSchluessel="key"
        baum={{ kinder: 'kinder', aufgeklappt: ['a'], onAufgeklappt }}
        karte={{ art: 'plan', titel: { spalte: 'bez' } }}
      />,
    );
    // Der Druckpfad der Kräfteübersicht setzt hier alle Schlüssel von außen. Ein Primitiv
    // mit internem Aufklappzustand hätte diesen Pfad lautlos stillgelegt.
    expect(auf.getByText('Einheit 1')).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────
// S8 · die Zeilenschleuse (Prüflisten-Kriterium 12, WCAG 3.2.5)
// ────────────────────────────────────────────────────────────────────────────────────

describe('Datensicht · Zeilenschleuse', () => {
  const zeilenZahl = (c: HTMLElement) => c.querySelectorAll('tr.ant-table-row').length;

  it('die Werkzeugzeile existiert AUCH ohne Suche, Filter, Schalter und Banner', () => {
    /**
     * Sonst schiebt die erste eintreffende Zeile den Inhalt nach unten und das Sammelbanner
     * arbeitet gegen sein eigenes Ziel — die Sticky-Reserve-Lehre aus B1.
     */
    const { container } = rendere({ spalten: spalten.slice(0, 1) });
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.querySelector('[data-lfh="datensicht-werkzeuge"]')).not.toBeNull();
  });

  it('mit Fokus in der Sicht bleibt die Zeilenmenge stehen und ein Banner erscheint', async () => {
    const { container, rerender } = rendere();
    expect(zeilenZahl(container)).toBe(3);

    screen.getByRole('link', { name: 'Florian 1' }).focus();
    const mehr = [...DREI, F(4, 'Florian 4'), F(5, 'Florian 5')];
    rerender(
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={mehr}
        zeilenSchluessel="id"
        karte={karte}
      />,
    );
    expect(zeilenZahl(container)).toBe(3);
    expect(screen.getByRole('button', { name: /2 neue Einträge/ })).toBeInTheDocument();

    // Klick aufs Banner übernimmt den Zufluss und räumt das Banner weg.
    await userEvent.click(screen.getByRole('button', { name: /2 neue Einträge/ }));
    expect(zeilenZahl(container)).toBe(5);
    expect(screen.queryByRole('button', { name: /neue Einträge/ })).toBeNull();
  });

  it('Zellinhalte laufen weiter, während die Zeilen stehen', () => {
    /**
     * DIE PFLICHTHÄLFTE. „Die Zeilenzahl ist nicht gewachsen" ist auch dann grün, wenn die
     * Komponente die neuen Daten KOMPLETT ignoriert. Ein Statuswechsel muss sofort sichtbar
     * sein — nur die Zeile darf nicht wandern.
     */
    const { container, rerender } = rendere();
    screen.getByRole('link', { name: 'Florian 1' }).focus();

    const geaendert = [F(1, 'Florian 1', { fahrzeugtyp: 'DLK' }), ...DREI.slice(1), F(9, 'Neu 9')];
    rerender(
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={geaendert}
        zeilenSchluessel="id"
        karte={karte}
      />,
    );
    expect(zeilenZahl(container)).toBe(3);
    expect(screen.getByText('DLK')).toBeInTheDocument();
  });

  it('auch die REIHENFOLGE steht, nicht nur die Menge', () => {
    /**
     * Ohne diesen Fall wäre die Schleuse auch dann grün, wenn sie nur „Schlüssel ∈ Menge"
     * filtert: die überlebenden Zeilen bekämen dann die NEUE Reihenfolge, und genau das ist
     * der Sprung unter dem Cursor, den Kriterium 12 verbietet.
     */
    const namen = (c: HTMLElement) =>
      [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);
    const { container, rerender } = rendere();
    expect(namen(container)).toEqual(['Florian 1', 'Rotkreuz 2', 'Florian 3']);

    screen.getByRole('link', { name: 'Florian 1' }).focus();
    rerender(
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={[DREI[2], DREI[0], DREI[1]]}
        zeilenSchluessel="id"
        karte={karte}
      />,
    );
    expect(namen(container)).toEqual(['Florian 1', 'Rotkreuz 2', 'Florian 3']);
  });

  it('ein Fokuswechsel INNERHALB der Sicht taut nicht auf', () => {
    /**
     * `focusout` feuert auch beim Sprung von der Titelzelle zum Aktionsknopf derselben
     * Sicht. Ein naiver Zuhörer taute dort auf und schöbe die Zeilen unter dem Finger weg —
     * genau in der Sekunde, in der jemand bedient. Deshalb `!wurzel.contains(relatedTarget)`.
     */
    const onSortierung = vi.fn();
    const { container, rerender } = rendere({ suche: { platzhalter: 'Funkrufname' }, onSortierung });
    screen.getByRole('link', { name: 'Florian 1' }).focus();

    const mehr = [...DREI, F(4, 'Florian 4')];
    const nachziehen = () =>
      rerender(
        <Datensicht<Fahrzeug, FahrzeugKey>
          bezeichnung="Fahrzeuge im Einsatz"
          spalten={spalten}
          daten={mehr}
          zeilenSchluessel="id"
          karte={karte}
          suche={{ platzhalter: 'Funkrufname' }}
          onSortierung={onSortierung}
        />,
      );
    nachziehen();
    expect(zeilenZahl(container)).toBe(3);

    // Fokus wandert auf das Suchfeld DERSELBEN Sicht — jsdom setzt `relatedTarget` dabei
    // wie ein Browser (am Stub gemessen), der Fall braucht kein handgereichtes Ereignis.
    container.querySelector<HTMLInputElement>('input[type="search"]')!.focus();
    nachziehen();
    expect(zeilenZahl(container)).toBe(3);
    expect(screen.getByRole('button', { name: /1 neuer Eintrag/ })).toBeInTheDocument();
  });

  it('verlässt der Fokus die Sicht, läuft der Zufluss ohne Banner durch', () => {
    const { container, rerender } = renderMitProviders(
      <>
        <button type="button">draußen</button>
        <Datensicht<Fahrzeug, FahrzeugKey>
          bezeichnung="Fahrzeuge im Einsatz"
          spalten={spalten}
          daten={DREI}
          zeilenSchluessel="id"
          karte={karte}
        />
      </>,
    );
    screen.getByRole('link', { name: 'Florian 1' }).focus();
    screen.getByRole('button', { name: 'draußen' }).focus();

    rerender(
      <>
        <button type="button">draußen</button>
        <Datensicht<Fahrzeug, FahrzeugKey>
          bezeichnung="Fahrzeuge im Einsatz"
          spalten={spalten}
          daten={[...DREI, F(4, 'Florian 4')]}
          zeilenSchluessel="id"
          karte={karte}
        />
      </>,
    );
    expect(zeilenZahl(container)).toBe(4);
    expect(screen.queryByRole('button', { name: /neue/ })).toBeNull();
  });

  it('eine ENTFALLENE Zeile verschwindet sofort, auch mit Fokus in der Sicht', () => {
    // Eine nicht mehr vorhandene Zeile kann man nicht rendern. Die Schleuse hält nur
    // Zuwachs zurück; dass eine verschwindende Zeile den Fokus mitnimmt, bleibt B7.
    const { container, rerender } = rendere();
    screen.getByRole('link', { name: 'Florian 1' }).focus();
    rerender(
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={[DREI[0], DREI[2]]}
        zeilenSchluessel="id"
        karte={karte}
      />,
    );
    expect(zeilenZahl(container)).toBe(2);
    expect(screen.queryByText('Rotkreuz 2')).toBeNull();
  });

  it('zufluss="sofort" friert nie ein', () => {
    const { container, rerender } = rendere({ zufluss: 'sofort' });
    screen.getByRole('link', { name: 'Florian 1' }).focus();
    rerender(
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={[...DREI, F(4, 'Florian 4')]}
        zeilenSchluessel="id"
        karte={karte}
        zufluss="sofort"
      />,
    );
    expect(zeilenZahl(container)).toBe(4);
    expect(screen.queryByRole('button', { name: /neue/ })).toBeNull();
  });

  it('die Schleuse greift auch im Kartenzweig', () => {
    setzeViewportBreite(390);
    const { container, rerender } = rendere();
    expect(karten(container)).toHaveLength(3);
    screen.getByRole('link', { name: 'Florian 1' }).focus();
    rerender(
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={[...DREI, F(4, 'Florian 4')]}
        zeilenSchluessel="id"
        karte={karte}
      />,
    );
    expect(karten(container)).toHaveLength(3);
    expect(screen.getByRole('button', { name: /1 neuer Eintrag/ })).toBeInTheDocument();
  });
});

describe('Datensicht · DEV-Diagnose', () => {
  it('meldet einen kaputten Kartenplan mit Präfix und Bezeichnung', () => {
    const spion = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rendere({ karte: { ...karte, titel: { spalte: 'tippfehler' as FahrzeugKey } } });
    const eigene = spion.mock.calls.filter((c) =>
      String(c[0]).includes('[Datensicht: Fahrzeuge im Einsatz]'),
    );
    expect(eigene).toHaveLength(1);
    expect(String(eigene[0][0])).toContain('tippfehler');
    spion.mockRestore();
  });
});
