import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
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

function renderMitProviders(
  ui: ReactElement,
  options?: Parameters<typeof renderMitBasisProviders>[1],
) {
  const ergebnis = renderMitBasisProviders(
    <CommandPaletteProvider>{ui}</CommandPaletteProvider>,
    options,
  );
  const basisRerender = ergebnis.rerender;
  return {
    ...ergebnis,
    rerender: (naechstesUi: ReactElement) =>
      basisRerender(<CommandPaletteProvider>{naechstesUi}</CommandPaletteProvider>),
  };
}

/**
 * Prüfungen des Datensicht-Primitivs (LFH-330 · B2).
 *
 * Die reinen Funktionen werden direkt gerufen, ohne Rendern. Für `pruefeKartenplan` heißt das:
 * kein `console.warn`-Spion, der die eigenen Meldungen gegen antds Fremdwarnungen abgrenzen
 * müsste.
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
     * Antds `render` darf `{ props, children }` liefern (`RenderedCell`). React-Elemente tragen
     * ebenfalls `props`: wer die Zellbeschreibung an `'props' in x` erkennt, packt jedes `<Space>`
     * aus und liefert `undefined`, die Kartenzelle bliebe leer. Dagegen greift dieser Fall.
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
    // antds `title` kann eine Funktion sein; ohne diesen Fall gäbe `etikettVon` still ein Objekt
    // als „Text".
    const spion = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(etikettVon({ key: 'a', title: () => <b>Funkrufname</b> })).toBeUndefined();
    expect(spion.mock.calls.filter((c) => String(c[0]).includes('[Spaltenschalter]'))).toHaveLength(
      1,
    );
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
     * `toBe`, nicht `toEqual`: nur Referenzgleichheit belegt, dass nichts angefasst wurde. Die
     * Aggregate der Meldebild-Elternzeilen sind über die VOLLMENGE kumuliert
     * (`kraefte/kraeftebild.ts`); fiele hier eine Zeile weg, lögen die Eltern still.
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

  it('Zahlen im Text sortieren nach ihrem WERT: Florian 2 vor Florian 10', () => {
    /**
     * Ein reiner Zeichenvergleich legt „Florian 10" vor „Florian 2" — im Einsatz die falsche Zeile
     * unter dem Finger.
     */
    const flotte = [F(1, 'Florian 10'), F(2, 'Florian 2'), F(3, 'Florian 1')];
    const auf = effektiveDaten({
      daten: flotte,
      spalten,
      sortierung: { spalte: 'funkrufname', richtung: 'auf' },
      suchbegriff: '',
      filterWerte: OHNE_FILTER,
      baum: false,
    });
    expect(auf.map((f) => f.funkrufname)).toEqual(['Florian 1', 'Florian 2', 'Florian 10']);

    const ab = effektiveDaten({
      daten: flotte,
      spalten,
      sortierung: { spalte: 'funkrufname', richtung: 'ab' },
      suchbegriff: '',
      filterWerte: OHNE_FILTER,
      baum: false,
    });
    expect(ab.map((f) => f.funkrufname)).toEqual(['Florian 10', 'Florian 2', 'Florian 1']);
  });

  it('null und undefined landen HINTEN — in BEIDEN Richtungen', () => {
    // Sonst wanderte „kein Wert" bei einem Richtungswechsel an den Anfang der Liste.
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
    // Sonst lägen die Gruppen nicht zusammenhängend, und der Tabellenzweig (ohne Gruppenzeilen)
    // zeigte eine Gruppierung, die man nicht sieht.
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
    // `traeger` hat keinen `suchText`: belegt „Freitextsuche nur über Spalten mit suchText".
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
    // `'THW'` steht in der Reihenfolge, hat aber keine Zeile: kein leerer Gruppenkopf „· 0".
    expect(gruppiere(daten, achse).map((g) => g.wert)).not.toContain('THW');
  });
});

describe('sichtbareSpalten()', () => {
  const immerBreit = () => true;

  it('Index 0 ist NIE entfernbar — nicht per Hand, nicht per Breite, nicht per beides', () => {
    /**
     * `KatalogTabelle` fixiert, was als Spalte 0 ankommt. Fällt Spalte 0 weg, wird still eine
     * ANDERE Spalte die fixierte Kennung. `immerSichtbar` allein ist ein Flag, das man vergisst;
     * die Invariante gehört hierher.
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
     * Ein Zähler, der „0 ausgeblendet" meldet, während zwei Spalten fehlen, verfehlt Kriterium 14.
     * Deshalb sind antds `responsive` und `hidden` am Spaltentyp gesperrt.
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
    // Fängt das `const K`-Widening, das der Typ NICHT schließt: eine als
    // `readonly DatensichtSpalte<Fahrzeug>[]` annotierte Spaltenliste weitet K auf `string`.
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
    expect(
      meldung(pruefeKartenplan({ spalten: doppelt, karte }, 'Fahrzeuge'), 'doppelt'),
    ).toHaveLength(1);
  });

  it('meldet eine sekundaer-Spalte ohne Etikett', () => {
    // Ohne Etikett zeigte die Karte einen Wert ohne Bedeutung. Nur Sekundärfelder brauchen es.
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
        gruppen: { schluessel: () => 'a', etikett: (w) => w, unterEbene: 1 },
      },
      'Meldebild',
    );
    expect(meldung(befunde, 'aufklappzeile')).toHaveLength(1);
    expect(meldung(befunde, 'gruppen')).toHaveLength(1);
  });

  it('meldet aufklappen zusammen mit baum und mit aufklappzeile (LFH-676)', () => {
    const baum = { kinder: 'kinder' as never, aufgeklappt: [], onAufgeklappt: () => {} };
    const ohneFilterSpalten = spalten.filter((s) => s.filter == null);
    const aufklappen = {
      etikett: 'Verlauf',
      zugaenglicherName: (f: Fahrzeug) => `Verlauf zu ${f.funkrufname}`,
      inhalt: () => 'Verlauf',
    };
    expect(
      meldung(
        pruefeKartenplan({ spalten: ohneFilterSpalten, karte, baum, aufklappen }, 'Meldebild'),
        'aufklappen',
      ),
    ).toHaveLength(1);
    expect(
      meldung(
        pruefeKartenplan(
          { spalten, karte, aufklappen, aufklappzeile: () => 'Besatzung' },
          'Fahrzeuge',
        ),
        'aufklappen',
      ),
    ).toHaveLength(1);
    expect(pruefeKartenplan({ spalten, karte, aufklappen }, 'Fahrzeuge')).toEqual([]);
    // Ein Eigenbau gibt `karte.render` roh zurück — dort liefe `aufklappen` still ins Leere.
    const eigen = { art: 'eigen' as const, render: () => null };
    expect(
      meldung(pruefeKartenplan({ spalten, karte: eigen, aufklappen }, 'Fahrzeuge'), 'aufklappen'),
    ).toHaveLength(1);
  });

  /**
   * Im Baummodus klappt die ganze Zeile auf (LFH-338 · C3). Ein zusätzliches `onZeileKlick` wäre
   * eine zweite Wirkung auf demselben Klick und wird gemeldet.
   */
  it('meldet baum zusammen mit onZeileKlick', () => {
    const baum = { kinder: 'kinder' as never, aufgeklappt: [], onAufgeklappt: () => {} };
    const ohneFilterSpalten = spalten.filter((s) => s.filter == null);
    const befunde = pruefeKartenplan(
      { spalten: ohneFilterSpalten, karte, baum, onZeileKlick: () => {} },
      'Meldebild',
    );
    expect(meldung(befunde, 'onzeileklick')).toHaveLength(1);
  });

  it('meldet eine Spaltengruppe mit sortWert', () => {
    // Eine Gruppe ist keine Blattspalte; ein `sortWert` daran wäre wirkungslos.
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
 * `NoInfer<K>` an jeder K-Position außer `spalten`: ohne das wird `K` aus dem Kartenplan
 * mitinferiert, ein Tippfehler weitet `K` um sein eigenes Literal, und die Literalbewahrung
 * wäre wirkungslos.
 *
 * Diese Blöcke fallen NUR über `tsc --noEmit`. Ohne `NoInfer` meldet TypeScript die
 * `@ts-expect-error`-Direktiven als ungenutzt (TS2578) — das Gate bricht in beide Richtungen.
 */
describe('Typgrenzen (nur tsc)', () => {
  it('Slot-Tippfehler und der vierte Sekundärslot brechen den Typcheck', () => {
    const gut = (
      <Datensicht
        bezeichnung="A"
        spalten={spalten}
        daten={DREI}
        zeilenSchluessel="id"
        karte={karte}
      />
    );

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

const DREI = [
  F(1, 'Florian 1', { traeger: 'FW' }),
  F(2, 'Rotkreuz 2', { traeger: 'HiOrg' }),
  F(3, 'Florian 3'),
];

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
  it.each([390, 767, 768, 1024, 1200, 1366])(
    'auto bricht bei md um — %i px (kein eigener Umbruchpunkt mehr, tabelleAb ist entfallen)',
    (breite) => {
      setzeViewportBreite(breite);
      const { container } = rendere();
      // md = 768 px (antd). LITERAL, nicht aus dem Grid zurückgelesen.
      expect(tabellen(container)).toHaveLength(breite >= 768 ? 1 : 0);
      expect(karten(container)).toHaveLength(breite >= 768 ? 0 : 3);
    },
  );

  it.each(['tabelle', 'karte'] as const)('feste Form %s gewinnt gegen die Breite', (form) => {
    setzeViewportBreite(form === 'tabelle' ? 390 : 1600);
    const { container } = rendere({ form });
    expect(tabellen(container)).toHaveLength(form === 'tabelle' ? 1 : 0);
    expect(karten(container)).toHaveLength(form === 'karte' ? 3 : 0);
  });

  it('bei 1024 px genau EIN Zweig: Tabelle, keine Karte', () => {
    /**
     * Die Gegenprobe zum Schmal-Fall ist Pflicht: ohne sie wäre der Schmal-Test auch grün, wenn die
     * Weiche bei JEDER Breite in den Kartenzweig kippt.
     */
    const { container } = rendere();
    expect(tabellen(container)).toHaveLength(1);
    expect(karten(container)).toHaveLength(0);
  });

  it('unter md genau EIN Zweig: Karten, keine Tabelle', () => {
    // `setzeViewportBreite` VOR dem Render: antds Beobachter liest `matches` beim Abonnieren, und
    // `abBreiteAus` liest „unbekannt" als BREIT.
    setzeViewportBreite(390);
    const { container } = rendere();
    expect(tabellen(container)).toHaveLength(0);
    expect(karten(container)).toHaveLength(3);
  });

  it('form="tabelle" bleibt bei 390 px eine Tabelle', () => {
    // Meldebild der Kräfteübersicht: Kriterium 14 verbietet dort die Auflösung in Karten.
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

  it('die md-Schwelle sitzt bei 768: 767 px Karten, 768 px Tabelle', () => {
    /**
     * Das Grenzpaar pinnt die Schwelle `md` (antds `screenMD` = 768); die Zweigtests oben (390 und
     * 1024 px) wären bei jeder Schwelle dazwischen grün.
     *
     * `useViewport` ist bewusst NICHT gemockt: die Breite kommt über den matchMedia-Stub durch den
     * echten Hook, sonst pinnte der Test die Schwelle im Mock statt im Produktivcode.
     */
    setzeViewportBreite(767);
    const schmal = rendere();
    expect(tabellen(schmal.container)).toHaveLength(0);
    expect(karten(schmal.container)).toHaveLength(3);
    schmal.unmount();

    setzeViewportBreite(768);
    const { container } = rendere();
    expect(tabellen(container)).toHaveLength(1);
    expect(karten(container)).toHaveLength(0);
  });

  it('trägt eine ansprechbare Region mit der Bezeichnung', () => {
    // `<section aria-label>`: ein nacktes `div` mit `aria-label` hat keine Rolle.
    rendere();
    expect(screen.getByRole('region', { name: 'Fahrzeuge im Einsatz' })).toBeInTheDocument();
  });
});

describe('Datensicht · Kartenzweig', () => {
  it('die Titelzelle ist in BEIDEN Zweigen ein echter Link', () => {
    /**
     * `ListenEintrag` ist ein nacktes `<div onClick>` ohne Tastaturweg. Das Tastaturziel der Zeile
     * ist deshalb der Titel-Link.
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
    // Ohne `bestaetigung` feuerte die Aktion im Kartenzweig ohne Rückfrage (Kriterium 4).
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
    // Ohne Opt-in bleibt auch der OK-Knopf neutral (Gegenhälfte zu `bestaetigungGefahr`).
    expect(await screen.findByRole('button', { name: 'OK' })).not.toHaveClass('ant-btn-dangerous');
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));
    expect(onKlick).toHaveBeenCalledWith(DREI[0]);
  });

  it('bestaetigungGefahr färbt NUR den OK-Knopf der Rückfrage rot, der Auslöser bleibt neutral', async () => {
    // Paar zum Fall darüber: dort bleibt der OK-Knopf ohne Opt-in neutral.
    setzeViewportBreite(390);
    const onKlick = vi.fn();
    const { container } = rendere({
      karte: {
        ...karte,
        aktion: {
          etikett: 'Entfernen',
          bestaetigung: 'Wirklich?',
          bestaetigungGefahr: true,
          zugaenglicherName: (f) => `${f.funkrufname} entfernen`,
          onKlick,
        },
      },
    });
    const ausloeser = screen.getByRole('button', { name: `${DREI[0].funkrufname} entfernen` });
    expect(ausloeser).not.toHaveClass('ant-btn-dangerous');
    expect(ausloeser).toHaveTextContent('Entfernen');
    expect(
      container.querySelectorAll('[data-lfh="datensicht-karte"] button[aria-label$=" entfernen"]'),
    ).toHaveLength(3);
    await userEvent.click(ausloeser);
    const ok = await screen.findByRole('button', { name: 'OK' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(onKlick).not.toHaveBeenCalled();
    await userEvent.click(ok);
    expect(onKlick).toHaveBeenCalledWith(DREI[0]);
  });

  it('laeuft() zeigt den Ladezustand nur am Auslöser der laufenden Zeile (LFH-654)', () => {
    setzeViewportBreite(390);
    rendere({
      karte: {
        ...karte,
        aktion: {
          etikett: 'Entfernen',
          bestaetigung: 'Wirklich?',
          zugaenglicherName: (f) => `${f.funkrufname} entfernen`,
          laeuft: (f) => f.id === DREI[1].id,
          onKlick: () => {},
        },
      },
    });
    const name = (i: number) => `${DREI[i].funkrufname} entfernen`;
    expect(screen.getByRole('button', { name: name(1) })).toHaveClass('ant-btn-loading');
    expect(screen.getByRole('button', { name: name(0) })).not.toHaveClass('ant-btn-loading');
    expect(screen.getByRole('button', { name: name(2) })).not.toHaveClass('ant-btn-loading');
  });

  it('ein laufender Auslöser öffnet keine zweite Rückfrage (LFH-654)', async () => {
    setzeViewportBreite(390);
    const onKlick = vi.fn();
    rendere({
      karte: {
        ...karte,
        aktion: {
          etikett: 'Entfernen',
          bestaetigung: 'Wirklich?',
          zugaenglicherName: (f) => `${f.funkrufname} entfernen`,
          laeuft: () => true,
          onKlick,
        },
      },
    });
    await userEvent.click(screen.getByRole('button', { name: `${DREI[0].funkrufname} entfernen` }));
    expect(screen.queryByText('Wirklich?')).not.toBeInTheDocument();
    expect(onKlick).not.toHaveBeenCalled();
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

  it('weitere Aktionen: EIN Menü-Auslöser je Zeile, mit der Zeilenkennung im Namen (LFH-639)', async () => {
    // Plan-Modus trägt genau EINE Primäraktion; alles Weitere wird gebündelt (LFH-365). Der
    // icon-only Auslöser trägt die Zeilenkennung im Namen.
    setzeViewportBreite(390);
    const onWahl = vi.fn();
    rendere({
      karte: {
        ...karte,
        aktion: { etikett: 'Melden', onKlick: () => {} },
        weitere: {
          eintraege: () => [
            { key: 'bearbeiten', label: 'Bearbeiten' },
            { key: 'stornieren', label: 'Stornieren', gefahr: true },
          ],
          zugaenglicherName: (f) => `Aktionen zu ${f.funkrufname}`,
          onWahl,
        },
      },
    });
    const ausloeser = screen.getByRole('button', { name: 'Aktionen zu Rotkreuz 2' });
    expect(screen.getAllByRole('button', { name: /^Aktionen zu / })).toHaveLength(3);
    // Die Primäraktion bleibt daneben stehen — das Menü ersetzt sie nicht.
    expect(screen.getAllByRole('button', { name: 'Melden' })).toHaveLength(3);
    await userEvent.click(ausloeser);
    const menue = await waitFor(() => {
      const m = document.querySelector(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      ) as HTMLElement | null;
      expect(m).not.toBeNull();
      return m!;
    });
    // Die Gefahr steht hinter einem Trenner, nicht bündig unter dem Neutralen.
    expect(menue.querySelector('.ant-dropdown-menu-item-divider')).not.toBeNull();
    const eintrag = within(menue).getByRole('menuitem', { name: /Stornieren/ });
    expect(eintrag).toHaveClass('ant-dropdown-menu-item-danger');
    await userEvent.click(eintrag);
    expect(onWahl).toHaveBeenCalledWith('stornieren', DREI[1]);
  });

  it('weitere Aktionen: bleibt nach dem Filtern nichts übrig, gibt es GAR KEINEN Auslöser', () => {
    // Gegenhälfte: ein deaktivierter oder leerer Auslöser wäre ein Ziel ohne Wirkung.
    setzeViewportBreite(390);
    rendere({
      karte: {
        ...karte,
        weitere: {
          eintraege: (f) => (f.id === 2 ? [{ key: 'bearbeiten', label: 'Bearbeiten' }] : []),
          zugaenglicherName: (f) => `Aktionen zu ${f.funkrufname}`,
          onWahl: () => {},
        },
      },
    });
    expect(screen.getAllByRole('button', { name: /^Aktionen zu / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Aktionen zu Rotkreuz 2' })).toBeInTheDocument();
  });

  it('der Statusslot rendert ein Etikett MIT Text, nicht nur eine Farbe', () => {
    // `label` ist am `StatusDarstellung`-Typ Pflicht und damit der zweite Kanal (WCAG 1.4.1).
    setzeViewportBreite(390);
    rendere({ karte: { ...karte, status: () => ({ rolle: 'normal', label: 'verfügbar' }) } });
    expect(screen.getAllByText('verfügbar')).toHaveLength(3);
  });

  it('ohne statusBedienung bleibt das Etikett reine Anzeige — kein Auslöser', () => {
    // Gegenaussage zum Test darunter: sonst wäre „der Slot ist bedienbar" auch grün, wenn JEDES
    // Etikett zum Knopf würde.
    setzeViewportBreite(390);
    const { container } = rendere({
      karte: { ...karte, status: () => ({ rolle: 'normal', label: 'verfügbar' }) },
    });
    const etiketten = container.querySelectorAll('[data-lfh="datensicht-karte"] .ant-tag');
    expect(etiketten).toHaveLength(3);
    for (const t of etiketten) expect(t.closest('button')).toBeNull();
  });

  it('mit statusBedienung wird das Statusetikett zum Auslöser der Statuswahl', async () => {
    // Der Bedienweg sitzt am STATUS-Slot: der Aktions-Slot trägt genau EINE Primäraktion, auf den
    // Kräfteseiten „Entfernen" (LFH-339 · C4).
    setzeViewportBreite(390);
    const onWaehlen = vi.fn();
    rendere({
      karte: {
        ...karte,
        status: () => ({ rolle: 'normal', label: 'verfügbar' }),
        statusBedienung: (f) => ({
          kennung: f.funkrufname,
          aktuell: 'frei',
          optionen: [
            { wert: 'frei', label: 'verfügbar' },
            { wert: 'gebunden', label: 'gebunden' },
          ],
          onWaehlen,
        }),
      },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Status von Florian 1 ändern' }));
    const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')].filter(
      (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
    );
    expect(offen).toHaveLength(1);
    const menue = offen[0].querySelector<HTMLElement>('[role="menu"]')!;
    await userEvent.click(within(menue).getByRole('menuitem', { name: /gebunden/ }));
    expect(onWaehlen).toHaveBeenCalledWith('gebunden');
  });

  it('Gruppen erscheinen im Kartenzweig als Köpfe mit Zähler', () => {
    setzeViewportBreite(390);
    rendere({
      gruppen: {
        schluessel: (f) => f.traeger ?? 'ohne',
        etikett: (w) => (w === 'FW' ? 'Feuerwehr' : 'Hilfsorganisation'),
        reihenfolge: ['FW', 'HiOrg'],
        unterEbene: 1,
      },
    });
    expect(screen.getByText('Feuerwehr · 2')).toBeInTheDocument();
    expect(screen.getByText('Hilfsorganisation · 1')).toBeInTheDocument();
  });

  it('Gruppenköpfe im Kartenzweig sind Überschriften unter `unterEbene` und benennen ihre Liste (LFH-470)', () => {
    setzeViewportBreite(390);
    rendere({
      gruppen: {
        schluessel: (f) => f.traeger ?? 'ohne',
        etikett: (w) => (w === 'FW' ? 'Feuerwehr' : 'Hilfsorganisation'),
        reihenfolge: ['FW', 'HiOrg'],
        unterEbene: 1,
      },
    });
    expect(screen.getAllByRole('heading', { level: 2 }).map((k) => k.textContent)).toEqual([
      'Feuerwehr · 2',
      'Hilfsorganisation · 1',
    ]);
    expect(screen.getByRole('list', { name: 'Feuerwehr · 2' })).toBeVisible();
  });

  it('leerText läuft über emptyText — es entsteht KEIN Empty-Knoten', () => {
    setzeViewportBreite(390);
    const { container } = rendere({ daten: [], leerText: 'Noch keine Fahrzeuge disponiert' });
    expect(screen.getByText('Noch keine Fahrzeuge disponiert')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
  });
});

describe('Datensicht · Aufklappbereich (LFH-676)', () => {
  /**
   * Ein beschrifteter Auslöser mit der Zeilenkennung im Namen, in BEIDEN Zweigen gleich. Der
   * Inhalt entsteht erst beim Aufklappen: der Betreuungsverlauf lädt beim Mount.
   */
  const aufklappenMit = (inhalt: (f: Fahrzeug) => ReactElement | string) => ({
    etikett: 'Verlauf',
    zugaenglicherName: (f: Fahrzeug) => `Verlauf zu ${f.funkrufname}`,
    inhalt,
  });

  it.each(['karte', 'tabelle'] as const)(
    '%s: beschrifteter Auslöser je Zeile, aria-expanded wechselt, Inhalt erst beim Aufklappen',
    async (form) => {
      const inhalt = vi.fn((f: Fahrzeug) => <p>Reihe von {f.funkrufname}</p>);
      rendere({ form, aufklappen: aufklappenMit(inhalt) });

      const knopf = screen.getByRole('button', { name: 'Verlauf zu Florian 1' });
      expect(knopf).toHaveTextContent('Verlauf');
      expect(knopf).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getAllByRole('button', { name: /^Verlauf zu / })).toHaveLength(3);
      expect(screen.queryByText('Reihe von Florian 1')).not.toBeInTheDocument();
      expect(inhalt).not.toHaveBeenCalled();

      await userEvent.click(knopf);
      expect(screen.getByRole('button', { name: 'Verlauf zu Florian 1' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByText('Reihe von Florian 1')).toBeInTheDocument();
      // Nur die aufgeklappte Zeile baut ihren Inhalt.
      expect(inhalt.mock.calls.every(([f]) => f.id === 1)).toBe(true);
      expect(screen.queryByText('Reihe von Rotkreuz 2')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Verlauf zu Florian 1' }));
      expect(screen.getByRole('button', { name: 'Verlauf zu Florian 1' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      // Die Karte hängt den Inhalt ab, antds Tabelle blendet die Aufklappzeile nur aus.
      const zu = screen.queryByText('Reihe von Florian 1');
      if (zu) expect(zu).not.toBeVisible();
    },
  );

  it('tabelle: der Auslöser sitzt in der angehefteten Kennungszelle, ohne eigene Aufklappspalte', () => {
    // Eine eigene Spalte HINTER der fixierten Kennung glitte bei 390 px unter sie, VOR ihr stünden
    // zwei angeheftete Spalten. In der Kennungszelle ist er immer erreichbar.
    const { container } = rendere({
      form: 'tabelle',
      aufklappen: aufklappenMit((f) => `Reihe von ${f.funkrufname}`),
    });
    const kennung = container.querySelector('tr[data-row-key="1"] > td') as HTMLElement;
    expect(kennung).toHaveTextContent('Florian 1');
    expect(within(kennung).getByRole('button')).toHaveAccessibleName('Verlauf zu Florian 1');
    expect(kennung.className).toMatch(/ant-table-cell-fix-(left|start)/);
    expect(container.querySelector('.ant-table-row-expand-icon-cell')).toBeNull();
  });

  it('karte: der Inhalt steht in einer Region, auf die der Auslöser zeigt', async () => {
    rendere({ form: 'karte', aufklappen: aufklappenMit((f) => `Reihe von ${f.funkrufname}`) });
    const knopf = screen.getByRole('button', { name: 'Verlauf zu Rotkreuz 2' });
    await userEvent.click(knopf);
    const region = screen.getByRole('region', { name: 'Verlauf zu Rotkreuz 2' });
    expect(knopf.getAttribute('aria-controls')).toBe(region.id);
    expect(region).toHaveTextContent('Reihe von Rotkreuz 2');
  });

  it('der Aufklappzustand überlebt den Wechsel zwischen Karte und Tabelle', async () => {
    const props = { aufklappen: aufklappenMit((f: Fahrzeug) => `Reihe von ${f.funkrufname}`) };
    const { rerender } = rendere({ form: 'karte', ...props });
    await userEvent.click(screen.getByRole('button', { name: 'Verlauf zu Florian 3' }));
    rerender(
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={DREI}
        zeilenSchluessel="id"
        karte={karte}
        form="tabelle"
        {...props}
      />,
    );
    expect(screen.getByRole('button', { name: 'Verlauf zu Florian 3' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Reihe von Florian 3')).toBeInTheDocument();
  });
});

describe('Datensicht · Tabellenzweig', () => {
  /**
   * LFH-340 · C5: Titel-Link und `onZeileKlick` liegen übereinander. Die Paarung ist Absicht —
   * der erste Fall allein wäre auch grün, wenn `onZeileKlick` gar nicht mehr feuerte.
   */
  it('ein Klick auf einen Link in der Zeile löst NICHT zusätzlich onZeileKlick aus', async () => {
    const zeileGeklickt = vi.fn();
    rendere({ onZeileKlick: zeileGeklickt });
    await userEvent.click(screen.getByRole('link', { name: 'Florian 1' }));
    expect(zeileGeklickt).not.toHaveBeenCalled();
  });

  it('ein Klick daneben löst onZeileKlick weiterhin aus', async () => {
    const zeileGeklickt = vi.fn();
    const { container } = rendere({ onZeileKlick: zeileGeklickt });
    // Die Typ-Zelle trägt keinen Anker — dort ist die Zeile das Ziel.
    const zellen = container.querySelectorAll('tr.ant-table-row td.ant-table-cell');
    await userEvent.click(zellen[1] as HTMLElement);
    expect(zeileGeklickt).toHaveBeenCalledTimes(1);
  });

  it('rendert durch KatalogTabelle: Scrollcontainer, stehende Kopfzeile, fixierte Kennung', () => {
    const { container } = rendere();
    expect(container.querySelector('.ant-table-sticky-holder')).not.toBeNull();
    const fixierte = container.querySelectorAll('th.ant-table-cell-fix-start');
    expect(fixierte).toHaveLength(1);
    expect(fixierte[0].textContent).toBe('Funkrufname');
  });

  it('blättert NICHT und bringt genau EIN Suchfeld mit', () => {
    /**
     * `Datensicht` gibt `KatalogTabelle` `pagination={false}` und setzt deren `suche` NICHT — sonst
     * blätterte die Tabelle unter der Zeilenschleuse weg, und zwei Suchfelder stünden da. Der Guard
     * sieht das nicht.
     */
    const viele = Array.from({ length: 60 }, (_, i) => F(i + 1, `Florian ${i + 1}`));
    const { container } = rendere({ daten: viele, suche: { platzhalter: 'Funkrufname' } });
    expect(container.querySelector('.ant-pagination')).toBeNull();
    expect(container.querySelectorAll('input[type="search"]')).toHaveLength(1);
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(60);
  });

  it('abBreite streicht die Spalte und der Schalter meldet den Zähler als TEXT', async () => {
    /**
     * Der Zähler steht als Text im Namen, NICHT als `Badge`: ein `count`-Badge ist ohne `color` rot,
     * und Rot bedient nichts.
     */
    const { container } = rendere({ spaltenAusVoreinstellung: ['traeger'] });
    const kopfzellen = [...container.querySelectorAll('th.ant-table-cell')].map(
      (z) => z.textContent,
    );
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

  it('zeigt genau EINEN Spaltenschalter, obwohl das Primitiv darunter selbst einen kann', () => {
    /**
     * `KatalogTabelle` trägt einen eigenen Schalter als Opt-in; setzte `Datensicht` ihn zusätzlich,
     * stünden zwei Knöpfe mit zwei Zuständen da. Der Guard hält das Attribut aus der Quelle, dieser
     * Fall das Bild.
     */
    rendere({ form: 'tabelle' });
    expect(screen.getAllByRole('button', { name: /^Spalten/ })).toHaveLength(1);
  });

  it('eine per Breite weggefallene Spalte steht OHNE Häkchen im Menü und lässt sich zurückholen', async () => {
    /**
     * LFH-374 · D9: das Häkchen zeigt die wirkliche Sichtbarkeit. Eine per `abBreite`
     * weggefallene Spalte steht nicht angehakt im Menü, und ein Klick holt sie zurück.
     */
    const { container } = rendere();
    const kopf = () =>
      [...container.querySelectorAll('th.ant-table-cell')].map((z) => z.textContent);
    expect(kopf()).not.toContain('Besatzung');

    await userEvent.click(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ }));
    const besatzung = await screen.findByRole('checkbox', { name: 'Besatzung' });
    expect(besatzung).not.toBeChecked();

    await userEvent.click(besatzung);
    expect(kopf()).toContain('Besatzung');
    const knopf = screen.getByRole('button', { name: /^Spalten —/ });

    // Neu öffnen und im OFFENEN Overlay greifen: das abgehende Overlay zeigt eingefrorenen Inhalt
    // (jsdom feuert kein `transitionend`).
    await userEvent.click(knopf);
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden):not(.ant-slide-up-leave) [role="menu"]',
      );
      expect(m).not.toBeNull();
      return m!;
    });
    expect(within(menue).getByRole('checkbox', { name: 'Besatzung' })).toBeChecked();
  });

  it('Suche und Sortierung wirken auf die Zeilenmenge, nicht nur auf die Anzeige', async () => {
    const namen = (c: HTMLElement) =>
      [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

    const { container } = rendere({
      suche: { platzhalter: 'Funkrufname' },
      standardSortierung: { spalte: 'funkrufname', richtung: 'auf' },
    });
    expect(namen(container)).toEqual(['Florian 1', 'Florian 3', 'Rotkreuz 2']);

    // Sortiert wird im Primitiv; die Tabelle bekommt nur `sorter: true` für den Pfeil. Antds Zyklus
    // endet in „keine Sortierung", also wieder der Serverordnung.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(namen(container)).toEqual(['Rotkreuz 2', 'Florian 3', 'Florian 1']);
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(namen(container)).toEqual(['Florian 1', 'Rotkreuz 2', 'Florian 3']);

    await userEvent.type(
      container.querySelector<HTMLInputElement>('input[type="search"]')!,
      'Rotkreuz',
    );
    expect(namen(container)).toEqual(['Rotkreuz 2']);
  });

  it('kontrollierte Sortierung meldet nach außen und rendert die Vorgabe', async () => {
    // Sortierung hat eine kontrollierte Form (Kandidat für ein späteres `?sort=`).
    const onSortierung = vi.fn();
    const { container } = rendere({
      sortierung: { spalte: 'funkrufname', richtung: 'auf' },
      onSortierung,
    });
    expect(
      [...container.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent),
    ).toEqual(['Florian 1', 'Florian 3', 'Rotkreuz 2']);
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(onSortierung).toHaveBeenCalledWith({ spalte: 'funkrufname', richtung: 'ab' });

    // Kontrolliert heißt kontrolliert: ohne Zutun des Aufrufers bleibt die Anzeige stehen.
    expect(
      [...container.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent),
    ).toEqual(['Florian 1', 'Florian 3', 'Rotkreuz 2']);
  });

  it('Spaltenfilter stehen in der Werkzeugzeile und wirken auf die Zeilenmenge', async () => {
    // `filters`/`onFilter` sind am Spaltentyp gesperrt, weil antd deren Zustand intern hält und der
    // Kartenzweig ihn nicht lesen könnte. Der Filter steht in der Werkzeugzeile.
    const { container } = rendere();
    expect(container.querySelector('.ant-table-filter-trigger')).toBeNull();

    await userEvent.click(screen.getByRole('combobox', { name: 'Träger' }));
    await userEvent.click(await screen.findByTitle('Feuerwehr'));
    expect(
      [...container.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent),
    ).toEqual(['Florian 1', 'Florian 3']);
  });

  it('Strg/⌘ + Backspace in der Werkzeugleiste leert Suche und internen Spaltenfilter', async () => {
    const { container } = rendere({ suche: { platzhalter: 'Funkrufname' } });
    const namen = () =>
      [...container.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);
    const suche = screen.getByRole('searchbox', { name: 'Suche in Fahrzeuge im Einsatz' });

    await userEvent.type(suche, 'Florian');
    await userEvent.click(screen.getByRole('combobox', { name: 'Träger' }));
    await userEvent.click(await screen.findByTitle('Hilfsorganisation'));
    await waitFor(() => expect(namen()).toEqual([]));

    suche.focus();
    const ereignis = new KeyboardEvent('keydown', {
      key: 'Backspace',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(suche, ereignis);

    expect(ereignis.defaultPrevented).toBe(true);
    expect(suche).toHaveValue('');
    await waitFor(() => expect(namen()).toEqual(['Florian 1', 'Rotkreuz 2', 'Florian 3']));
    expect(screen.getByRole('combobox', { name: 'Träger' })).toHaveValue('');
  });

  it('übernimmt native Wortlöschung nicht, wenn der Fokus im Ergebnisbereich steht', async () => {
    rendere({ suche: { platzhalter: 'Funkrufname' } });
    const suche = screen.getByRole('searchbox', { name: 'Suche in Fahrzeuge im Einsatz' });
    await userEvent.type(suche, 'Florian');

    const ergebnisLink = screen.getByRole('link', { name: 'Florian 1' });
    ergebnisLink.focus();
    const ereignis = new KeyboardEvent('keydown', {
      key: 'Backspace',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(ergebnisLink, ereignis);

    expect(ereignis.defaultPrevented).toBe(false);
    expect(suche).toHaveValue('Florian');
  });

  it('ein Filter wirkt NICHT mehr, sobald seine Spalte ausgeblendet ist — und wieder, wenn sie zurückkommt', async () => {
    /**
     * Wer die gefilterte Spalte ausblendet, darf keine gefilterte Liste ohne sichtbaren Grund
     * behalten. Geprüft wird die Zeilenmenge, nicht der Zustand.
     */
    const { container } = rendere();
    const namen = () =>
      [...container.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

    /**
     * Immer über das GEÖFFNETE Menü: antd lässt die Portale geschlossener Dropdowns im Baum stehen,
     * ein freier Griff kann ein totes Kästchen erwischen.
     */
    const koepfe = () =>
      [...container.querySelectorAll('th.ant-table-cell')].map((z) => z.textContent);
    /**
     * Öffnet den Schalter und gibt das OFFENE Menü zurück, notfalls mit einem zweiten Klick: eine
     * noch offene Auswahlliste des Spaltenfilters verbraucht den ersten Klick als Außenklick, und
     * sie zu schließen gelingt in jsdom auf keinem Weg.
     */
    const oeffneMenue = async (): Promise<HTMLElement> => {
      const knopf = screen.getByRole('button', { name: /Spalten/ });
      for (let i = 0; i < 3; i += 1) {
        await userEvent.click(knopf);
        const offen = document.querySelector<HTMLElement>(
          '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
        );
        if (offen) return offen;
      }
      throw new Error('Der Spaltenschalter ließ sich in drei Klicks nicht öffnen');
    };
    const schalteSpalte = async (etikett: string, danach: 'weg' | 'da') => {
      const menue = await oeffneMenue();
      await userEvent.click(within(menue).getByRole('checkbox', { name: etikett }));
      // Auf die WIRKUNG warten, nicht auf den Klick — sonst prüfte die nächste Zusicherung gegen
      // einen Baum, der die Umschaltung noch nicht verarbeitet hat.
      await waitFor(() =>
        danach === 'weg'
          ? expect(koepfe()).not.toContain(etikett)
          : expect(koepfe()).toContain(etikett),
      );
    };

    await userEvent.click(screen.getByRole('combobox', { name: 'Träger' }));
    await userEvent.click(await screen.findByTitle('Feuerwehr'));
    await waitFor(() => expect(namen()).toEqual(['Florian 1', 'Florian 3']));

    /*
     * Die geöffnete Auswahlliste wird bewusst NICHT eigens geschlossen (in jsdom trägt kein Weg);
     * den Test tragen die beiden Wartestellen in `schalteSpalte`.
     */

    await schalteSpalte('Träger', 'weg');
    expect(namen(), 'ohne die Spalte ist auch ihr Filter unwirksam').toEqual([
      'Florian 1',
      'Rotkreuz 2',
      'Florian 3',
    ]);
    // Das Bedienelement ist mit der Spalte verschwunden.
    expect(screen.queryByRole('combobox', { name: 'Träger' })).toBeNull();

    // Erneut öffnen: das Menü schließt nach jedem Umschalten.
    await schalteSpalte('Träger', 'da');
    expect(namen(), 'die Spalte zurück, der gemerkte Filter wirkt wieder').toEqual([
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
      {
        key: 'a',
        bezeichnung: 'Abschnitt Nord',
        kinder: [{ key: 'a1', bezeichnung: 'Einheit 1' }],
      },
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
    // Der Druckpfad der Kräfteübersicht setzt hier alle Schlüssel von außen; ein interner
    // Aufklappzustand hätte ihn lautlos stillgelegt.
    expect(auf.getByText('Einheit 1')).toBeInTheDocument();
  });

  /**
   * Die ganze Zeile klappt auf, nicht nur das Symbol (LFH-338 · C3). Das rund 16 px breite
   * Aufklapp-Symbol ist im Handschuh-Betrieb kein Bedienziel. Die Regel gehört ins Primitiv, nicht
   * in ein seitenlokales `onRow`.
   */
  it('klappt beim Klick auf die ZEILE auf, nicht nur am Aufklapp-Symbol', async () => {
    interface Zeile {
      key: string;
      bezeichnung: string;
      kinder?: Zeile[];
    }
    const baumSpalten = spaltenFuer<Zeile>()([
      { key: 'bez', title: 'Bezeichnung', dataIndex: 'bezeichnung', immerSichtbar: true },
    ]);
    const daten: Zeile[] = [
      {
        key: 'a',
        bezeichnung: 'Abschnitt Nord',
        kinder: [{ key: 'a1', bezeichnung: 'Einheit 1' }],
      },
    ];
    const onAufgeklappt = vi.fn();
    renderMitProviders(
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

    // Die TEXTZELLE, nicht `.ant-table-row-expand-icon`.
    await userEvent.click(screen.getByText('Abschnitt Nord'));
    expect(onAufgeklappt).toHaveBeenCalledWith(['a']);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────
// S8 · die Zeilenschleuse (Prüflisten-Kriterium 12, WCAG 3.2.5)
// ────────────────────────────────────────────────────────────────────────────────────

describe('Datensicht · Zeilenschleuse', () => {
  const zeilenZahl = (c: HTMLElement) => c.querySelectorAll('tr.ant-table-row').length;

  it('die Werkzeugzeile existiert AUCH ohne Suche, Filter, Schalter und Banner', () => {
    /**
     * Sonst schiebt die erste eintreffende Zeile den Inhalt nach unten, und das Sammelbanner
     * arbeitet gegen sein eigenes Ziel.
     */
    const { container } = rendere({ spalten: spalten.slice(0, 1) });
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.querySelector('[data-lfh="datensicht-werkzeuge"]')).not.toBeNull();
  });

  it('die LEERE Ladeansicht friert nicht ein — und schärft sich beim nächsten Fokuseintritt nach', () => {
    /**
     * Fokus im Suchfeld vor der ersten Antwort darf keine LEERE Folge einfrieren — sonst landete die
     * ganze erste Lieferung hinter dem Sammelbanner.
     *
     * Drei Fallen in diesem Test:
     *  - `suche` muss in JEDEM Render stehen. Fehlt es, meldet sich das Suchfeld ab, der Fokus fällt
     *    auf den Body, die Schleuse taut von selbst auf, und der Test wäre ohne die Bedingung grün.
     *  - „3 Zeilen, kein Banner" allein ist auch grün, wenn `betreten` gar nicht mehr einfriert. Die
     *    Gegenprobe ist der Nachbartest „mit Fokus in der Sicht …" und die zweite Hälfte hier.
     *  - `ladend` ist NICHT die Bedingung im Produktivcode: ein Query, der auf `[]` auflöst und erst
     *    per SSE Zeilen bekommt, hat `ladend === false` bei leerer Menge.
     */
    const suche = { platzhalter: 'Funkrufname' };
    const sicht = (daten: Fahrzeug[], ladend: boolean) => (
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={daten}
        zeilenSchluessel="id"
        karte={karte}
        suche={suche}
        ladend={ladend}
      />
    );

    const { container, rerender } = renderMitProviders(sicht([], true));
    // antd rendert für die leere Menge `ant-table-placeholder`, keine `ant-table-row`: der
    // Startpunkt ist nachweislich 0.
    expect(zeilenZahl(container)).toBe(0);

    container.querySelector<HTMLInputElement>('input[type="search"]')!.focus();
    rerender(sicht(DREI, false));

    expect(zeilenZahl(container)).toBe(3);
    expect(screen.queryByRole('button', { name: /neue/ })).toBeNull();

    // Die Schleuse ist jetzt OFFEN und schärft sich beim nächsten Fokuseintritt nach (`focusin`
    // bubbelt). Belegt zugleich, dass die Bedingung NUR den Null-Zeilen-Fall ausnimmt.
    screen.getByRole('link', { name: 'Florian 1' }).focus();
    rerender(sicht([...DREI, F(4, 'Florian 4')], false));
    expect(zeilenZahl(container)).toBe(3);
    expect(screen.getByRole('button', { name: /1 neuer Eintrag/ })).toBeInTheDocument();
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

  it('der Spaltenschalter ist eine Benutzeraktion — die freigegebene Zeile steht sofort da', async () => {
    /**
     * Regressionstest: `setzeSpaltenAus` muss wie Sortierung, Suche und Filter
     * {@link nachBenutzeraktion} rufen. Sonst zählte die durch den unwirksam gewordenen Filter
     * freigegebene Zeile bei gefrorener Schleuse als ZUFLUSS und landete hinter dem Sammelbanner.
     *
     * Zwei Hälften, beide Pflicht: „3 Zeilen" allein wäre auch grün ohne Einfrieren, „kein Banner"
     * allein auch, wenn die Zeile ganz verschwände.
     *
     * `fireEvent` statt `userEvent` trägt den Test: `userEvent` zieht den Fokus ins Dropdown-Portal,
     * `pruefeVerlassen` taut auf, und der Test würde auch ohne den Fix zeitweise grün.
     */
    const { container } = rendere();
    const namen = () =>
      [...container.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);
    const koepfe = () =>
      [...container.querySelectorAll('th.ant-table-cell')].map((z) => z.textContent);

    await userEvent.click(screen.getByRole('combobox', { name: 'Träger' }));
    await userEvent.click(await screen.findByTitle('Feuerwehr'));
    await waitFor(() => expect(namen()).toEqual(['Florian 1', 'Florian 3']));

    // Menü öffnen, BEVOR eingefroren wird: der Öffnungsklick verschiebt den Fokus ohnehin.
    const knopf = screen.getByRole('button', { name: /Spalten/ });
    let menue: HTMLElement | null = null;
    for (let i = 0; i < 3 && !menue; i += 1) {
      await userEvent.click(knopf);
      menue = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      );
    }
    expect(menue, 'der Spaltenschalter ließ sich in drei Klicks nicht öffnen').not.toBeNull();

    /**
     * Antds Dropdown zieht den Fokus per `autoFocus` NACHGELAGERT ins Menü. Käme das nach dem
     * `focus()` unten, taute `pruefeVerlassen` die Schleuse auf, und der Test wäre ohne den Fix grün.
     * Erst warten, bis der Fokus im Menü ist, DANN einfrieren.
     */
    await waitFor(() => expect(menue!.contains(document.activeElement)).toBe(true));

    // JETZT einfrieren: Fokus auf einem Zeilen-Link in der Sicht.
    screen.getByRole('link', { name: 'Florian 1' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Florian 1' }));

    fireEvent.click(within(menue!).getByRole('checkbox', { name: 'Träger' }));
    await waitFor(() => expect(koepfe()).not.toContain('Träger'));

    expect(namen(), 'die freigegebene Zeile steht in der Liste').toEqual([
      'Florian 1',
      'Rotkreuz 2',
      'Florian 3',
    ]);
    expect(
      screen.queryByRole('button', { name: /Eintr/ }),
      'sie ist die Antwort auf den Klick, kein Zufluss — also kein Sammelbanner',
    ).toBeNull();
  });

  it('Zellinhalte laufen weiter, während die Zeilen stehen', () => {
    /**
     * Die Pflichthälfte: „die Zeilenzahl ist nicht gewachsen" ist auch grün, wenn die Komponente
     * neue Daten KOMPLETT ignoriert. Ein Statuswechsel muss sofort sichtbar sein, nur die Zeile darf
     * nicht wandern.
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
     * Sonst wäre die Schleuse auch grün, wenn sie nur „Schlüssel ∈ Menge" filtert: die Zeilen
     * bekämen die NEUE Reihenfolge — der Sprung unter dem Cursor, den Kriterium 12 verbietet.
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
     * `focusout` feuert auch beim Sprung innerhalb derselben Sicht; ein naiver Zuhörer taute dort
     * auf. Deshalb `!wurzel.contains(relatedTarget)`.
     */
    const onSortierung = vi.fn();
    const { container, rerender } = rendere({
      suche: { platzhalter: 'Funkrufname' },
      onSortierung,
    });
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

    // Fokus wandert auf das Suchfeld DERSELBEN Sicht; jsdom setzt `relatedTarget` dabei wie ein
    // Browser.
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
    // Die Schleuse hält nur Zuwachs zurück; eine nicht mehr vorhandene Zeile kann man nicht rendern.
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

  it('die eingefrorene Sicht hält auch die GRUPPENZUGEHÖRIGKEIT — die Karte wandert nicht unter einen anderen Kopf', () => {
    /**
     * „Nur die Zeile darf nicht wandern" gilt auch für die Gruppe: ohne eingefrorene Gruppenachse
     * hinge ein Statuswechsel die Karte im Kartenzweig unter einen anderen Kopf um.
     *
     * Der Zellinhalt zeigt den neuen Wert trotzdem sofort; beides steht im selben Test, sonst wäre
     * „eingefroren" auch durch stehengebliebene Inhalte erfüllt.
     */
    setzeViewportBreite(390);
    const gruppen = {
      schluessel: (f: Fahrzeug) => f.traeger ?? 'ohne',
      etikett: (w: string) =>
        w === 'FW' ? 'Feuerwehr' : w === 'HiOrg' ? 'Hilfsorganisation' : 'ohne Träger',
      reihenfolge: ['FW', 'HiOrg'],
      unterEbene: 1 as const,
    };
    const { rerender } = rendere({ gruppen });
    expect(screen.getByText('Feuerwehr · 2')).toBeInTheDocument();
    expect(screen.getByText('Hilfsorganisation · 1')).toBeInTheDocument();

    screen.getByRole('link', { name: 'Florian 1' }).focus();
    rerender(
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={[{ ...DREI[0], traeger: 'HiOrg' }, DREI[1], DREI[2]]}
        zeilenSchluessel="id"
        karte={karte}
        gruppen={gruppen}
      />,
    );

    expect(
      screen.getByText('Feuerwehr · 2'),
      'die Karte bleibt unter ihrem alten Kopf',
    ).toBeInTheDocument();
    expect(screen.getByText('Hilfsorganisation · 1')).toBeInTheDocument();
    // Der neue Wert steht trotzdem in der Karte — eingefroren ist die POSITION, nicht der Inhalt.
    expect(screen.getAllByText('HiOrg')).toHaveLength(2);
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

describe('Datensicht · Baum mit Titel-Link (LFH-548)', () => {
  interface Knoten {
    key: string;
    name: string;
    kinder?: Knoten[];
  }
  const BAUM: Knoten[] = [
    { key: 'a', name: 'Abschnitt Nord', kinder: [{ key: 'e', name: '1. Zug' }] },
    { key: 's', name: 'Sammel', kinder: [{ key: 'f', name: 'Florian ELW' }] },
  ];
  const knotenSpalten = spaltenFuer<Knoten>()([
    { title: 'Stelle', key: 'stelle', dataIndex: 'name', immerSichtbar: true },
  ]);

  function rendereBaum(onAufgeklappt: (k: React.Key[]) => void) {
    return renderMitProviders(
      <Datensicht<Knoten, 'stelle'>
        bezeichnung="Baum"
        form="tabelle"
        spalten={knotenSpalten}
        daten={BAUM}
        zeilenSchluessel="key"
        baum={{ kinder: 'kinder', aufgeklappt: [], onAufgeklappt }}
        karte={{
          art: 'plan',
          titel: { spalte: 'stelle', ziel: (k) => (k.key === 's' ? null : `/ziel/${k.key}`) },
          sekundaer: [],
        }}
      />,
    );
  }

  it('ein Klick auf den Titel-Link klappt den Knoten NICHT um (auch nicht beim Strg-Klick)', async () => {
    const onAufgeklappt = vi.fn();
    rendereBaum(onAufgeklappt);
    await userEvent.click(screen.getByRole('link', { name: 'Abschnitt Nord' }));
    fireEvent.click(screen.getByRole('link', { name: 'Abschnitt Nord' }), { ctrlKey: true });
    expect(onAufgeklappt).not.toHaveBeenCalled();
  });

  it('ein Klick daneben klappt den Knoten weiter auf', async () => {
    const onAufgeklappt = vi.fn();
    const { container } = rendereBaum(onAufgeklappt);
    const zeile = container.querySelector('tr[data-row-key="a"] td') as HTMLElement;
    await userEvent.click(zeile);
    expect(onAufgeklappt).toHaveBeenCalledWith(['a']);
  });

  it('ein Klick auf eine Blattzeile schaltet nichts um', async () => {
    const onAufgeklappt = vi.fn();
    const { container } = renderMitProviders(
      <Datensicht<Knoten, 'stelle'>
        bezeichnung="Baum"
        form="tabelle"
        spalten={knotenSpalten}
        daten={BAUM}
        zeilenSchluessel="key"
        baum={{ kinder: 'kinder', aufgeklappt: ['a'], onAufgeklappt }}
        karte={{ art: 'plan', titel: { spalte: 'stelle' }, sekundaer: [] }}
      />,
    );
    await userEvent.click(container.querySelector('tr[data-row-key="e"] td') as HTMLElement);
    expect(onAufgeklappt).not.toHaveBeenCalled();
  });

  it('das Aufklappsymbol schaltet genau einmal um, per Maus und per Tastatur', async () => {
    const onAufgeklappt = vi.fn();
    const { container } = rendereBaum(onAufgeklappt);
    const symbol = container.querySelector(
      'tr[data-row-key="a"] .ant-table-row-expand-icon',
    ) as HTMLElement;
    await userEvent.click(symbol);
    expect(onAufgeklappt).toHaveBeenCalledTimes(1);
    expect(onAufgeklappt).toHaveBeenLastCalledWith(['a']);
    symbol.focus();
    await userEvent.keyboard('{Enter}');
    expect(onAufgeklappt).toHaveBeenCalledTimes(2);
  });

  it('ein Knopf in der Zeile und ein Klick aus einem Portal-Menü schalten nichts um', async () => {
    const onAufgeklappt = vi.fn();
    const mitKnopf = spaltenFuer<Knoten>()([
      { title: 'Stelle', key: 'stelle', dataIndex: 'name', immerSichtbar: true },
      {
        title: 'Aktion',
        key: 'aktion',
        render: (_t, k) => (
          <>
            <button type="button">Status {k.name}</button>
            {createPortal(<div role="menuitem">Menü {k.name}</div>, document.body)}
          </>
        ),
      },
    ]);
    renderMitProviders(
      <Datensicht<Knoten, 'stelle' | 'aktion'>
        bezeichnung="Baum"
        form="tabelle"
        spalten={mitKnopf}
        daten={BAUM}
        zeilenSchluessel="key"
        baum={{ kinder: 'kinder', aufgeklappt: [], onAufgeklappt }}
        karte={{ art: 'plan', titel: { spalte: 'stelle' }, sekundaer: [] }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Status Abschnitt Nord' }));
    await userEvent.click(screen.getByText('Menü Abschnitt Nord'));
    expect(onAufgeklappt).not.toHaveBeenCalled();
  });

  it('eine Zeile, deren Ziel null ist, trägt keinen Link, sondern nur ihren Text', () => {
    rendereBaum(vi.fn());
    expect(screen.queryByRole('link', { name: 'Sammel' })).toBeNull();
    expect(screen.getByText('Sammel')).toBeInTheDocument();
  });
});
