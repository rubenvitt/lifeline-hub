import { describe, it, expect, vi } from 'vitest';
import {
  baueDatensatzTreffer,
  etbVolltextMoeglich,
  sichtbareDatensaetze,
  zahlAusSuche,
  type DatensatzKontext,
} from './datensaetze';
import { filtereBefehle, ordneTreffer, praefixStufe, type Treffer } from './fuzzy';
import type { Befehl, DatensatzQuelle, PaletteModus } from './typen';
import type {
  Auftrag,
  Einheit,
  Einsatzabschnitt,
  Gefahrengebiet,
  LageberichtAnzeige,
  EinsatzFahrzeug,
  EinsatzPersonal,
  EtbEintragAnzeige,
  Meldung,
  ModulOverride,
  Person,
  Schaden,
  Uhs,
} from '../api/types';
import { benutzerFixture } from '../test/fixtures';

/**
 * Fixturen als TEILOBJEKTE mit `as`-Cast: der Kern liest je Entität zwei bis drei Felder, volle
 * DTOs wären Rauschen. Dass die gelesenen Felder existieren, hält der Typcheck der
 * Produktivseite fest.
 */
const person = (o: Partial<Person>): Person =>
  ({
    id: 1,
    einsatz_id: 5,
    registrier_nr: 1,
    status: 'erfasst',
    name: null,
    vorname: null,
    ...o,
  }) as Person;
const schaden = (o: Partial<Schaden>): Schaden =>
  ({
    id: 1,
    einsatz_id: 5,
    registrier_nr: 1,
    typ: 'sachschaden',
    ort: 'Hauptstr',
    ...o,
  }) as Schaden;
const uhs = (o: Partial<Uhs>): Uhs =>
  ({ id: 1, einsatz_id: 5, bezeichnung: 'BHP 1', typ: 'behandlungsplatz', ...o }) as Uhs;
const meldung = (o: Partial<Meldung>): Meldung =>
  ({ id: 1, einsatz_id: 5, lfd_nr: 1, absender: 'Leitstelle', inhalt: 'x', ...o }) as Meldung;
const auftrag = (o: Partial<Auftrag>): Auftrag =>
  ({ id: 1, einsatz_id: 5, lfd_nr: 1, auftrag_text: 'Abschnitt erkunden', ...o }) as Auftrag;
const fahrzeug = (o: Partial<EinsatzFahrzeug>): EinsatzFahrzeug =>
  ({ id: 1, einsatz_id: 5, funkrufname: 'Florian 1', ...o }) as EinsatzFahrzeug;
const personal = (o: Partial<EinsatzPersonal>): EinsatzPersonal =>
  ({ id: 1, einsatz_id: 5, name: 'Meier', ...o }) as EinsatzPersonal;
const einheit = (o: Partial<Einheit>): Einheit =>
  ({ id: 1, einsatz_id: 5, name: 'SEG 1', ...o }) as Einheit;
const etb = (o: Partial<EtbEintragAnzeige>): EtbEintragAnzeige =>
  ({ id: 1, lfd_nr: 1, inhalt: 'Lage erkundet', typ: 'lage', ...o }) as EtbEintragAnzeige;

const fuehrungskraft = benutzerFixture({ anzeigename: 'EL', org_rolle: 'fuehrungskraft' });

/** Vollständiges ModulOverride bauen (Bauform `befehle.test.ts:19`). */
function ueberschreibung(felder: Partial<ModulOverride>): ModulOverride {
  return {
    einsatz_id: 5,
    modul_key: 'personen',
    sichtbar: true,
    benoetigte_rolle: null,
    geaendert_at: null,
    geaendert_von: null,
    ...felder,
  };
}

function kontext(over: Partial<DatensatzKontext> = {}): DatensatzKontext {
  return {
    einsatzId: 5,
    suche: '',
    modus: 'alles',
    benutzer: fuehrungskraft,
    overrides: undefined,
    aktuellerModulKey: null,
    navigate: vi.fn(),
    quellen: {},
    ...over,
  };
}

const ids = (t: Treffer[]) => t.map((x) => x.befehl.id);
/**
 * „Kontext · Label“: die Zeile, wie sie gelesen wird. Die Modulherkunft steht als `kontext`
 * neben dem Label; der Helfer setzt beide zusammen, damit die Aussagen die Herkunft mitprüfen.
 */
const labels = (t: Treffer[]) => t.map((x) => `${x.befehl.kontext} · ${x.befehl.label}`);

// ─────────────────────────────────────────────────────────────────────────────
describe('zahlAusSuche', () => {
  /**
   * Die drei Schreibweisen plus Sortenbindung. Führende Nullen fallen weg: `R-042` ist nur die
   * Anzeige der Zahl.
   */
  it.each([
    ['42', 42, null],
    ['042', 42, null],
    ['R-042', 42, 'person'],
    ['r-42', 42, 'person'],
    ['S-3', 3, 'schaden'],
    ['#214', 214, null],
    ['  42  ', 42, null],
    ['R042', 42, 'person'],
    ['R 42', 42, 'person'],
  ])('liest %s als Nummer %i mit Sorte %s', (eingabe, nummer, sorte) => {
    expect(zahlAusSuche(eingabe as string)).toEqual({ nummer, sorte });
  });

  /** Gegenaussage: ohne sie wäre jede Eingabe eine Nummer und der Textzweig tot. */
  it.each(['', 'Müller', '4a', 'R-', 'R-4-2', '4.2', '-42'])('erkennt %s NICHT als Nummer', (e) => {
    expect(zahlAusSuche(e)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — die drei Akzeptanzkriterien', () => {
  it('findet eine Person über die Registriernummer und navigiert auf personDetailPfad', () => {
    const k = kontext({
      suche: '42',
      quellen: { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] },
    });
    const t = baueDatensatzTreffer(k);
    expect(ids(t)).toEqual(['datensatz:personen:7']);
    t[0].befehl.ausfuehren();
    // Literal-Pin auf den Builder-Ausgang: `personDetailPfad(5, 7)` auf beiden Seiten prüfte den
    // Builder gegen sich selbst.
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/personen/7');
  });

  it('findet dieselbe Person über R-042, 042 und 42', () => {
    const quellen = { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] };
    for (const suche of ['R-042', '042', '42']) {
      expect(ids(baueDatensatzTreffer(kontext({ suche, quellen })))).toEqual([
        'datensatz:personen:7',
      ]);
    }
  });

  it('findet ein Fahrzeug über den Funkrufnamen und navigiert auf fahrzeugePfad', () => {
    const k = kontext({
      suche: 'florian',
      quellen: { fahrzeuge: [fahrzeug({ id: 7, funkrufname: 'Florian 1' })] },
    });
    const t = baueDatensatzTreffer(k);
    expect(ids(t)).toEqual(['datensatz:fahrzeuge:7']);
    t[0].befehl.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/fahrzeuge?fahrzeug=7');
  });

  it('findet einen ETB-Eintrag über die lfd. Nr. und navigiert auf etbPfad', () => {
    const k = kontext({ suche: '99', quellen: { etbNummer: [etb({ id: 12, lfd_nr: 99 })] } });
    const t = baueDatensatzTreffer(k);
    expect(ids(t)).toEqual(['datensatz:etb:12']);
    t[0].befehl.ausfuehren();
    // `?eintrag=` trägt die DB-`id`, nicht die laufende Nummer.
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/etb?eintrag=12');
  });

  /**
   * Die übrigen Ziele als Literal-Pin. Die Wahl des Builders ist eine Entscheidung: die Einheit
   * nutzt die Item-Route, `einheitenPfad(id, { einheit })` existiert daneben; der falsche Builder
   * führte still auf eine gültige Seite.
   */
  it.each([
    ['schaeden', { schaeden: [schaden({ id: 7, registrier_nr: 42 })] }, '/einsaetze/5/schaeden/7'],
    [
      'unfallhilfsstellen',
      { uhs: [uhs({ id: 7, bezeichnung: 'BHP 42' })] },
      '/einsaetze/5/unfallhilfsstellen/7',
    ],
    [
      'meldungen',
      { meldungen: [meldung({ id: 7, lfd_nr: 42 })] },
      '/einsaetze/5/meldungen?meldung=7',
    ],
    [
      'auftraege',
      { auftraege: [auftrag({ id: 7, lfd_nr: 42 })] },
      '/einsaetze/5/auftraege?auftrag=7',
    ],
    [
      'personal',
      { personal: [personal({ id: 7, name: 'Nr 42' })] },
      '/einsaetze/5/personal?personal=7',
    ],
    ['einheiten', { einheiten: [einheit({ id: 7, name: 'SEG 42' })] }, '/einsaetze/5/einheiten/7'],
  ])('führt %s auf den Builder aus routing/deeplinks.ts', (_modul, quellen, ziel) => {
    const k = kontext({ suche: '42', quellen });
    const t = baueDatensatzTreffer(k);
    expect(t).toHaveLength(1);
    t[0].befehl.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith(ziel);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Rangfolge', () => {
  /**
   * `praefixStufe` rechnet die Stufe aus dem LABEL: „Personen · R-042 · Müller“ läge bei '42' auf
   * Stufe 3, ein Einsatz „Einsatz 42“ auf Stufe 2 und damit VOR dem exakten Nummerntreffer.
   * Deshalb trägt ein Nummerntreffer seine Stufe selbst. Die Vorabprüfung auf den Fuse-Lauf ist
   * nötig, sonst wäre die Ordnungsaussage trivial grün.
   */
  it('stellt einen Nummerntreffer vor einen Fuzzy-Treffer, der ein Wort mit der Zahl trägt', () => {
    const einsatzBefehl: Befehl = {
      id: 'einsatz:9',
      gruppe: 'einsaetze',
      label: 'Einsatz 42',
      ausfuehren: () => {},
    };
    const rauschen = filtereBefehle([einsatzBefehl], '42');
    expect(rauschen, 'Fuse findet den Einsatz — sonst prüft der Test nichts').toHaveLength(1);

    const nummer = baueDatensatzTreffer(
      kontext({
        suche: '42',
        quellen: { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] },
      }),
    );
    expect(nummer[0].stufe, 'Nummerntreffer tragen die beste Stufe').toBe(0);

    expect(ordneTreffer([...rauschen, ...nummer], '42').map((b) => b.id)[0]).toBe(
      'datensatz:personen:7',
    );
  });

  /**
   * Die Stufe eines TEXTtreffers kommt aus dem BASISLABEL: mit Modulherkunft ergäbe 'person'
   * Stufe 1 für die ganze Personenliste, gleichauf mit dem Modulbefehl.
   *
   * Gesucht wird 'person', nicht 'personen': bei Gleichheit stünde das Modul auf Stufe 0 und
   * gewänne in jeder Fassung, der Test wäre nicht rot zu bekommen.
   */
  it('lässt den Modulbefehl vorn, wenn die Suche den Modulnamen trifft', () => {
    const modul: Befehl = {
      id: 'modul:personen',
      gruppe: 'module',
      label: 'Personen',
      ausfuehren: () => {},
    };
    const modulTreffer = filtereBefehle([modul], 'person');
    expect(modulTreffer).toHaveLength(1);
    const datensatz = baueDatensatzTreffer(
      kontext({
        suche: 'person',
        quellen: { personen: [person({ id: 7, registrier_nr: 42, name: 'Personendorf' })] },
      }),
    );
    expect(datensatz, 'der Datensatz wird gefunden — sonst prüft der Test nichts').toHaveLength(1);

    expect(ordneTreffer([...datensatz, ...modulTreffer], 'person').map((b) => b.id)[0]).toBe(
      'modul:personen',
    );
  });

  /**
   * Dieselbe Frage auf GLEICHER Stufe: „Einheit Nord“ und das Modul „Einheiten“ stehen beide auf
   * Stufe 1, dann entscheidet der Score. Ein Datensatz-Treffer ist nie durch Fuse gelaufen; eine
   * 0 verdrängte den bewerteten Modultreffer, und Enter öffnete einen Datensatz statt der
   * Modulseite. Wer einen Modulnamen tippt, will das Modul.
   *
   * Der Datensatz steht in der Eingabe VORN, sonst rettete ihn der Eingabeindex.
   */
  it('lässt den Modulbefehl vorn, wenn ein Datensatzlabel dasselbe Präfix trägt', () => {
    const modul: Befehl = {
      id: 'modul:einheiten',
      gruppe: 'module',
      label: 'Einheiten',
      ausfuehren: () => {},
    };
    const modulTreffer = filtereBefehle([modul], 'einheit');
    expect(modulTreffer, 'Fuse findet das Modul — sonst prüft der Test nichts').toHaveLength(1);
    expect(praefixStufe(modul, 'einheit'), 'der Modultreffer steht auf Stufe 1').toBe(1);

    const datensatz = baueDatensatzTreffer(
      kontext({
        suche: 'einheit',
        quellen: { einheiten: [einheit({ id: 3, name: 'Einheit Nord' })] },
      }),
    );
    expect(
      datensatz[0]?.stufe,
      'GLEICHE Stufe — sonst entschiede die Stufe und nicht der Score',
    ).toBe(1);

    expect(ordneTreffer([...datensatz, ...modulTreffer], 'einheit').map((b) => b.id)[0]).toBe(
      'modul:einheiten',
    );
  });

  /**
   * Gegenrichtung: ein Nummerntreffer steht auf Stufe 0, und die Stufe schlägt jeden Score. Ohne
   * diese Hälfte wäre „Befehl vor Datensatz“ auch grün, wenn die Regel den Nummerntreffer
   * erschlüge.
   */
  it('hält den Nummerntreffer vor dem bewerteten Modultreffer', () => {
    const modul: Befehl = {
      id: 'modul:personen',
      gruppe: 'module',
      label: 'Personen 42',
      ausfuehren: () => {},
    };
    const modulTreffer = filtereBefehle([modul], '42');
    expect(modulTreffer, 'Fuse findet das Modul — sonst prüft der Test nichts').toHaveLength(1);
    const nummer = baueDatensatzTreffer(
      kontext({
        suche: '42',
        quellen: { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] },
      }),
    );
    expect(ordneTreffer([...modulTreffer, ...nummer], '42').map((b) => b.id)[0]).toBe(
      'datensatz:personen:7',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Der Heimvorteil des aktuellen Moduls. Fahrzeug und Personal tragen beide einen nackten Namen
 * als Basislabel und stehen auf derselben Stufe; nur so ist der Vorteil an der Reihenfolge
 * ablesbar.
 */
describe('baueDatensatzTreffer — Heimvorteil des aktuellen Moduls', () => {
  const gleichnamig = {
    fahrzeuge: [fahrzeug({ id: 7, funkrufname: 'Florian 1' })],
    personal: [personal({ id: 8, name: 'Florian 1' })],
  };

  /**
   * BEIDE Richtungen als Paar: die Fahrzeug-Hälfte allein wäre auch ohne Heimvorteil grün, weil
   * die Quellentabelle die Fahrzeuge vor das Personal stellt.
   */
  it('stellt bei gleicher Stufe den Treffer aus dem Modul voran, in dem man steht', () => {
    const gleich = baueDatensatzTreffer(kontext({ suche: 'florian', quellen: gleichnamig }));
    expect(
      gleich.map((t) => t.stufe),
      'GLEICHE Stufe — sonst entschiede sie und nicht die Herkunft',
    ).toEqual([1, 1]);

    expect(
      ids(
        baueDatensatzTreffer(
          kontext({
            suche: 'florian',
            quellen: gleichnamig,
            aktuellerModulKey: 'personal',
          }),
        ),
      ),
    ).toEqual(['datensatz:personal:8', 'datensatz:fahrzeuge:7']);

    expect(
      ids(
        baueDatensatzTreffer(
          kontext({
            suche: 'florian',
            quellen: gleichnamig,
            aktuellerModulKey: 'fahrzeuge',
          }),
        ),
      ),
    ).toEqual(['datensatz:fahrzeuge:7', 'datensatz:personal:8']);
  });

  /**
   * Der Vorteil ist Tiebreak NACH der Stufe: in „Personen“ bekommt 'florian' zuerst das Fahrzeug
   * „Florian 1“ (Stufe 1) vor der Person (Stufe 2). Vor der Stufe wäre er ein Modulfilter.
   */
  it('lässt die Stufe über dem Heimvorteil stehen', () => {
    const quellen = {
      personen: [person({ id: 3, registrier_nr: 3, name: 'Florian' })],
      fahrzeuge: [fahrzeug({ id: 7, funkrufname: 'Florian 1' })],
    };
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'florian',
        quellen,
        aktuellerModulKey: 'personen',
      }),
    );
    // Als MENGE geprüft, sonst schlüge diese Zeile bei einem umsortierten Ergebnis zuerst an.
    expect(
      new Set(t.map((x) => x.stufe)),
      'ungleiche Stufen — sonst prüft der Test nichts',
    ).toEqual(new Set([1, 2]));
    expect(ids(t)).toEqual(['datensatz:fahrzeuge:7', 'datensatz:personen:3']);
  });

  /**
   * '42' trifft im Betrieb Person, Meldung und Auftrag zugleich, alle auf Stufe 0; welcher zuerst
   * steht, beantwortet der Kontext.
   */
  it('zieht den Nummerntreffer des aktuellen Moduls nach vorn', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })],
      meldungen: [meldung({ id: 9, lfd_nr: 42, absender: 'Leitstelle' })],
    };
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen })))).toEqual([
      'datensatz:personen:7',
      'datensatz:meldungen:9',
    ]);
    expect(
      ids(
        baueDatensatzTreffer(
          kontext({
            suche: '42',
            quellen,
            aktuellerModulKey: 'meldungen',
          }),
        ),
      ),
    ).toEqual(['datensatz:meldungen:9', 'datensatz:personen:7']);
  });

  /**
   * Der Vorteil entscheidet über das ÜBERLEBEN am Gesamtdeckel, deshalb sitzt er im
   * Sortierschlüssel: fünfzehn Plätze, sechzehn gleichstufige Treffer, und die Einheit steht in der
   * Quellentabelle zuletzt.
   */
  it('rettet den Treffer des aktuellen Moduls über den Gesamtdeckel', () => {
    const quellen = {
      uhs: Array.from({ length: 5 }, (_, i) => uhs({ id: 40 + i, bezeichnung: 'Nord' })),
      fahrzeuge: Array.from({ length: 5 }, (_, i) =>
        fahrzeug({ id: 60 + i, funkrufname: 'Nord 1' }),
      ),
      // Kein Label ist mit dem Suchwort IDENTISCH, sonst hinge die Aussage an der Stufe.
      personal: Array.from({ length: 5 }, (_, i) => personal({ id: 80 + i, name: 'Nord 3' })),
      einheiten: [einheit({ id: 99, name: 'Nord 2' })],
    };
    const ohne = baueDatensatzTreffer(kontext({ suche: 'nord', quellen }));
    expect(new Set(ohne.map((t) => t.stufe)), 'alle sechzehn auf derselben Stufe').toEqual(
      new Set([1]),
    );
    expect(ohne, 'der Gesamtdeckel bleibt bei fünfzehn').toHaveLength(15);
    expect(ids(ohne)).not.toContain('datensatz:einheiten:99');

    const mit = baueDatensatzTreffer(
      kontext({ suche: 'nord', quellen, aktuellerModulKey: 'einheiten' }),
    );
    expect(mit).toHaveLength(15);
    expect(ids(mit)[0]).toBe('datensatz:einheiten:99');
  });

  /**
   * Der Vorteil ordnet nur die DATENSÄTZE untereinander. Wer in „Einheiten“ „einheit“ tippt, meint
   * die Modulseite; in `ordneTreffer` entscheidet nach der Stufe der Score, und der ist für jeden
   * Datensatz-Treffer UNBEWERTET.
   */
  it('lässt den Modulbefehl vorn, auch wenn man in diesem Modul steht', () => {
    const modul: Befehl = {
      id: 'modul:einheiten',
      gruppe: 'module',
      label: 'Einheiten',
      ausfuehren: () => {},
    };
    const modulTreffer = filtereBefehle([modul], 'einheit');
    expect(modulTreffer, 'Fuse findet das Modul — sonst prüft der Test nichts').toHaveLength(1);
    const datensatz = baueDatensatzTreffer(
      kontext({
        suche: 'einheit',
        quellen: { einheiten: [einheit({ id: 3, name: 'Einheit Nord' })] },
        aktuellerModulKey: 'einheiten',
      }),
    );
    expect(datensatz[0]?.stufe, 'GLEICHE Stufe wie der Modultreffer').toBe(1);

    expect(ordneTreffer([...datensatz, ...modulTreffer], 'einheit').map((b) => b.id)[0]).toBe(
      'modul:einheiten',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Sortenbindung und Nullbarkeit', () => {
  /** PAAR: die negative Hälfte allein wäre auch grün, wenn gar nichts gefunden würde. */
  it('bindet R- an die Person und S- an den Schaden', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42 })],
      schaeden: [schaden({ id: 8, registrier_nr: 42 })],
    };
    expect(ids(baueDatensatzTreffer(kontext({ suche: 'R-042', quellen })))).toEqual([
      'datensatz:personen:7',
    ]);
    expect(ids(baueDatensatzTreffer(kontext({ suche: 'S-042', quellen })))).toEqual([
      'datensatz:schaeden:8',
    ]);
    // Ohne Sortenbuchstaben zählt die Zahl allein — beide Sorten stehen dann da.
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen }))).sort()).toEqual([
      'datensatz:personen:7',
      'datensatz:schaeden:8',
    ]);
  });

  /**
   * MANV ohne Identität: `name`/`vorname` sind nullbar, `registrier_nr` Pflicht. `personLabel`
   * fällt auf die Nummer zurück; der Test pinnt die Wiederverwendung.
   */
  it('hält eine Person ohne Namen über ihre Nummer auffindbar', () => {
    const t = baueDatensatzTreffer(
      kontext({
        suche: '42',
        quellen: { personen: [person({ id: 7, registrier_nr: 42, name: null, vorname: null })] },
      }),
    );
    expect(labels(t)).toEqual(['Personen · R-042']);
  });

  /** `AuftragAnzeige.lfd_nr` ist nullbar; `null` darf nie matchen. */
  it('lässt einen Auftrag ohne lfd. Nr. aus dem Zahlenzweig fallen', () => {
    const mitNr = { auftraege: [auftrag({ id: 7, lfd_nr: 42 })] };
    const ohneNr = { auftraege: [auftrag({ id: 7, lfd_nr: null })] };
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen: mitNr })))).toEqual([
      'datensatz:auftraege:7',
    ]);
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen: ohneNr })))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die Auftragszeile trägt ihre lfd. Nr.: ohne sie wäre ein Treffer auf die abgetippte 42 nicht
 * nachprüfbar, und gleichlautende Aufträge ergäben ununterscheidbare Zeilen. Form wie
 * `meldungLabel`/`etbLabel`: `#<nr> · <Text>`.
 */
describe('baueDatensatzTreffer — Auftragszeile', () => {
  it('setzt die lfd. Nr. vor den Auftragstext', () => {
    const t = baueDatensatzTreffer(
      kontext({
        suche: '42',
        quellen: {
          auftraege: [auftrag({ id: 7, lfd_nr: 42, auftrag_text: 'Abschnitt erkunden' })],
        },
      }),
    );
    expect(labels(t)).toEqual(['Aufträge/Befehle · #42 · Abschnitt erkunden']);
  });

  it('unterscheidet zwei gleichlautende Aufträge', () => {
    const quellen = {
      auftraege: [
        auftrag({ id: 7, lfd_nr: 12, auftrag_text: 'Lage melden' }),
        auftrag({ id: 8, lfd_nr: 13, auftrag_text: 'Lage melden' }),
      ],
    };
    const l = labels(baueDatensatzTreffer(kontext({ suche: 'lage melden', quellen })));
    expect(l).toEqual([
      'Aufträge/Befehle · #12 · Lage melden',
      'Aufträge/Befehle · #13 · Lage melden',
    ]);
  });

  /** `AuftragAnzeige.lfd_nr` ist NULLBAR: die Zeile bleibt ohne Nummernteil statt „#null“. */
  it('lässt einen Auftrag ohne lfd. Nr. ohne Nummernteil stehen', () => {
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'lage',
        quellen: { auftraege: [auftrag({ id: 7, lfd_nr: null, auftrag_text: 'Lage melden' })] },
      }),
    );
    expect(labels(t)).toEqual(['Aufträge/Befehle · Lage melden']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Rechte', () => {
  /** PAAR: „kein Treffer" allein wäre trivial grün, auch wenn der Riegel ALLES verwürfe. */
  it('zeigt Personen-Treffer, solange das Modul freigegeben ist', () => {
    const quellen = { personen: [person({ id: 7, registrier_nr: 42 })] };
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen })))).toEqual([
      'datensatz:personen:7',
    ]);
  });
  it('unterdrückt Personen-Treffer, wenn das Personen-Modul ausgeblendet ist', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42 })],
      schaeden: [schaden({ id: 8, registrier_nr: 42 })],
    };
    const overrides = { personen: ueberschreibung({ modul_key: 'personen', sichtbar: false }) };
    // Der Schaden bleibt — der Riegel wirkt je Modul, nicht global.
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen, overrides })))).toEqual([
      'datensatz:schaeden:8',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Textzweig und ETB', () => {
  it('filtert die acht Listenquellen lokal per Teilzeichenkette, unabhängig von der Schreibweise', () => {
    const quellen = {
      personal: [personal({ id: 7, name: 'Müller' }), personal({ id: 8, name: 'Schmidt' })],
    };
    expect(ids(baueDatensatzTreffer(kontext({ suche: 'MÜLL', quellen })))).toEqual([
      'datensatz:personal:7',
    ]);
  });

  /**
   * Der ETB-Volltext ist SERVERSEITIG entschieden; ein lokaler Filter über das Label würfe
   * Treffer weg, deren Fundstelle nicht im Label steht.
   */
  it('nimmt serverseitig bestätigte ETB-Volltexttreffer ohne zweiten lokalen Filter', () => {
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'brandschutz',
        quellen: {
          etbText: [
            etb({
              id: 12,
              lfd_nr: 99,
              inhalt: 'Lage erkundet',
              veranlassung: 'Brandschutz gestellt',
            }),
          ],
        },
      }),
    );
    expect(ids(t)).toEqual(['datensatz:etb:12']);
  });

  /**
   * `before_lfd_nr` filtert strikt `<`; bei einer Nummernlücke liefert der Cursor den
   * nächstälteren Eintrag, ohne Gleichheitsvergleich stünde still der falsche da.
   */
  it('verwirft eine Cursor-Antwort, deren lfd. Nr. nicht die gesuchte ist', () => {
    const k = kontext({ suche: '99', quellen: { etbNummer: [etb({ id: 12, lfd_nr: 97 })] } });
    expect(ids(baueDatensatzTreffer(k))).toEqual([]);
  });

  it('führt einen ETB-Eintrag, der in beiden Zweigen steckt, nur einmal', () => {
    const eintrag = etb({ id: 12, lfd_nr: 99 });
    const t = baueDatensatzTreffer(
      kontext({ suche: '99', quellen: { etbNummer: [eintrag], etbText: [eintrag] } }),
    );
    expect(ids(t)).toEqual(['datensatz:etb:12']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Deckel, Beschriftung, Leerfall', () => {
  it('deckelt auf fünf Treffer je Entität', () => {
    const personen = Array.from({ length: 9 }, (_, i) =>
      person({ id: i + 1, registrier_nr: i + 1, name: `Müller ${i}` }),
    );
    expect(baueDatensatzTreffer(kontext({ suche: 'müller', quellen: { personen } }))).toHaveLength(
      5,
    );
  });

  /**
   * Der Nummerntreffer liegt in einer Quelle, die ERST NACH drei randvollen Textquellen kommt; ohne
   * seinen Vorrang fiele er dem Gesamtdeckel zum Opfer.
   */
  it('deckelt die Gesamtmenge, ohne den Nummerntreffer zu verlieren', () => {
    const personen = Array.from({ length: 9 }, (_, i) =>
      person({ id: i + 1, registrier_nr: 10 + i, name: 'Nord 4' }),
    );
    const schaeden = Array.from({ length: 9 }, (_, i) =>
      schaden({ id: 40 + i, registrier_nr: 40 + i, ort: 'Nord 4' }),
    );
    const uhsListe = Array.from({ length: 9 }, (_, i) =>
      uhs({ id: 60 + i, bezeichnung: 'Nord 4' }),
    );
    const meldungen = [meldung({ id: 90, lfd_nr: 4, absender: 'Zentrale' })];
    const t = baueDatensatzTreffer(
      kontext({
        suche: '4',
        quellen: { personen, schaeden, uhs: uhsListe, meldungen },
      }),
    );
    expect(t).toHaveLength(15);
    expect(ids(t)).toContain('datensatz:meldungen:90');
  });

  /**
   * ERST ORDNEN, DANN DECKELN (Obermeier-Fall): fünf „Obermeier“ (Stufe 3) dürfen den gesuchten
   * „Meier“ (Stufe 2) nicht aus der Quelle drängen; Nachtippen hilft dort nicht. Geprüft wird, WER
   * in den Deckel kommt, nicht wie viele.
   */
  it('nimmt beim Deckel je Quelle die bessere Stufe, nicht die Listenreihenfolge', () => {
    const personen = [
      ...Array.from({ length: 5 }, (_, i) =>
        person({ id: i + 1, registrier_nr: i + 1, name: 'Obermeier' }),
      ),
      person({ id: 6, registrier_nr: 6, name: 'Meier' }),
    ];
    const t = baueDatensatzTreffer(kontext({ suche: 'mei', quellen: { personen } }));
    expect(t, 'der Deckel je Quelle bleibt bei fünf').toHaveLength(5);
    expect(ids(t)[0]).toBe('datensatz:personen:6');
  });

  /**
   * Derselbe Fehler am GESAMTdeckel (Nord-Fall): drei Quellen auf Stufe 2 füllen die fünfzehn
   * Plätze, das Fahrzeug „Nord 1“ auf Stufe 1 muss trotzdem erscheinen.
   */
  it('deckelt die Gesamtmenge nach Stufe, nicht nach Quellenreihenfolge', () => {
    const personen = Array.from({ length: 5 }, (_, i) =>
      person({ id: i + 1, registrier_nr: i + 1, name: 'Nordwind' }),
    );
    const schaeden = Array.from({ length: 5 }, (_, i) =>
      schaden({ id: 20 + i, registrier_nr: 20 + i, ort: 'Nordstr' }),
    );
    const uhsListe = Array.from({ length: 5 }, (_, i) =>
      uhs({ id: 40 + i, bezeichnung: 'BHP Nordplatz' }),
    );
    const fahrzeuge = [fahrzeug({ id: 60, funkrufname: 'Nord 1' })];
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'nord',
        quellen: { personen, schaeden, uhs: uhsListe, fahrzeuge },
      }),
    );
    expect(t, 'der Gesamtdeckel bleibt bei fünfzehn').toHaveLength(15);
    expect(ids(t)[0]).toBe('datensatz:fahrzeuge:60');
  });

  /** Die Modulherkunft kommt aus `modulRegistry.label`, als KONTEXT neben dem Label und als
   *  Schlagwort, damit die Suche nach dem Modulnamen den Datensatz findet. */
  it('trägt die Modulherkunft als Kontext, nicht mehr im Label', () => {
    const [p] = baueDatensatzTreffer(
      kontext({ suche: '42', quellen: { personen: [person({ id: 7, registrier_nr: 42 })] } }),
    );
    expect(p.befehl.kontext).toBe('Personen');
    expect(p.befehl.label.startsWith('Personen')).toBe(false);
    expect(p.befehl.schlagworte).toContain('Personen');
  });

  it('setzt Kontext und Label zur gelesenen Zeile zusammen', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })],
      uhs: [uhs({ id: 8, bezeichnung: 'BHP Nord', typ: 'behandlungsplatz' })],
      meldungen: [meldung({ id: 9, lfd_nr: 42, absender: 'Leitstelle' })],
    };
    expect(labels(baueDatensatzTreffer(kontext({ suche: '42', quellen }))).sort()).toEqual([
      'Meldungen (eingehend) · #42 · Leitstelle',
      'Personen · R-042 · Müller',
    ]);
    expect(labels(baueDatensatzTreffer(kontext({ suche: 'bhp', quellen })))).toEqual([
      'Unfallhilfsstellen · BHP Nord (behandlungsplatz)',
    ]);
  });

  it('legt jeden Treffer in die Gruppe datensaetze', () => {
    const t = baueDatensatzTreffer(
      kontext({
        suche: '42',
        quellen: {
          personen: [person({ id: 7, registrier_nr: 42 })],
          schaeden: [schaden({ id: 8, registrier_nr: 42 })],
        },
      }),
    );
    expect(t.map((x) => x.befehl.gruppe)).toEqual(['datensaetze', 'datensaetze']);
  });

  /**
   * Ohne Suchbegriff KEINE Datensatz-Treffer: die Startansicht ist kuratiert, und `''.includes`
   * passte auf alles.
   */
  it('liefert bei leerer Suche nichts', () => {
    const quellen = { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] };
    expect(baueDatensatzTreffer(kontext({ suche: '   ', quellen }))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die zwei Datensatz-Modi. Der Filter steht auch im Kern, nicht nur im Hook: eine `useQuery` mit
 * `enabled: false` liefert weiter ihre zwischengespeicherte Antwort.
 *
 * Die Menge hinter '@' ist alles mit einem NAMEN als Suchmerkmal (Personen, Fahrzeuge, Personal,
 * Einheiten); die übrigen Quellen tragen einen Sachverhalt.
 */
describe('baueDatensatzTreffer — Präfixmodi (LFH-391 · C3)', () => {
  const alleQuellen = {
    personen: [person({ id: 7, registrier_nr: 42, name: 'Nord' })],
    fahrzeuge: [fahrzeug({ id: 3, funkrufname: 'Nord 1' })],
    personal: [personal({ id: 4, name: 'Nord Meier' })],
    einheiten: [einheit({ id: 5, name: 'Nord SEG' })],
    schaeden: [schaden({ id: 8, registrier_nr: 42, ort: 'Nordstr' })],
    meldungen: [meldung({ id: 9, lfd_nr: 42, absender: 'Nord' })],
    uhs: [uhs({ id: 10, bezeichnung: 'Nord BHP' })],
    auftraege: [auftrag({ id: 11, lfd_nr: 42, auftrag_text: 'Nord erkunden' })],
    etbText: [etb({ id: 12, lfd_nr: 99, inhalt: 'Nordabschnitt' })],
  };

  it('liefert unter „@" Person, Fahrzeug, Personal und Einheit', () => {
    const t = baueDatensatzTreffer(
      kontext({ modus: 'kraefte', suche: 'nord', quellen: alleQuellen }),
    );
    expect(ids(t).sort()).toEqual([
      'datensatz:einheiten:5',
      'datensatz:fahrzeuge:3',
      'datensatz:personal:4',
      'datensatz:personen:7',
    ]);
  });

  /** Die tragende negative Hälfte: ohne sie wäre auch ein Modus grün, der gar nicht filtert. */
  it('liefert unter „@" keinen Schaden, keine Meldung, keine Unfallhilfsstelle, keinen Auftrag und keinen ETB-Eintrag', () => {
    const t = baueDatensatzTreffer(
      kontext({ modus: 'kraefte', suche: 'nord', quellen: alleQuellen }),
    );
    expect(ids(t).filter((id) => !/personen|fahrzeuge|personal|einheiten/.test(id))).toEqual([]);
    // Gegenprobe im selben Lauf: ohne Präfix stehen sie sehr wohl da.
    const ohne = ids(baueDatensatzTreffer(kontext({ suche: 'nord', quellen: alleQuellen })));
    expect(ohne).toContain('datensatz:schaeden:8');
    expect(ohne).toContain('datensatz:meldungen:9');
  });

  it('liefert unter „#" nur ETB-Einträge', () => {
    const t = baueDatensatzTreffer(kontext({ modus: 'etb', suche: 'nord', quellen: alleQuellen }));
    expect(ids(t)).toEqual(['datensatz:etb:12']);
  });

  /**
   * `#42` wird zu Modus 'etb' mit Rest '42'; ohne Modusriegel fände der Zahlenzweig jede Person und
   * Meldung mit der Nummer 42 mit.
   */
  it('liefert unter „#" keine Person, auch wenn ihre Nummer passt', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })],
      etbNummer: [etb({ id: 12, lfd_nr: 42 })],
    };
    expect(ids(baueDatensatzTreffer(kontext({ modus: 'etb', suche: '42', quellen })))).toEqual([
      'datensatz:etb:12',
    ]);
    // Gegenprobe: ohne Präfix findet dieselbe Zahl beide.
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen }))).sort()).toEqual([
      'datensatz:etb:12',
      'datensatz:personen:7',
    ]);
  });

  /** Der `>`-Modus zeigt nur Aktionen, keine Datensatzzeile, auch nicht aus einem warmen Cache. */
  it('liefert im Aktionen-Modus gar nichts', () => {
    expect(
      baueDatensatzTreffer(kontext({ modus: 'aktionen', suche: 'nord', quellen: alleQuellen })),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die Riegel an der ANZEIGE: eine anstehende Trefferliste belegt nicht, dass die aktuelle Eingabe
 * sie rechtfertigt (warmer Cache, Entprellung). Hier die reine Aussage; wie sie sich in der
 * Palette anfühlt, prüft `CommandPalette.test.tsx`.
 */
describe('etbVolltextMoeglich', () => {
  /**
   * Die Wahrheitstafel von `fts_query` (src/etb/repo.rs): Tokens ohne alphanumerisches Zeichen
   * fallen weg; bleibt nichts, lässt das Backend den MATCH-Filter ganz weg.
   */
  it.each(['??', '--', '...', '<>', '§$%', '🚒🚑', '  ', ''])('verneint %s', (e) => {
    expect(etbVolltextMoeglich(e)).toBe(false);
  });

  /** Die Gegenhälfte, inklusive der gemischten Eingabe: EIN brauchbares Token genügt. */
  it.each(['brand', '42', '?? brand', 'B-2', 'öl'])('bejaht %s', (e) => {
    expect(etbVolltextMoeglich(e)).toBe(true);
  });
});

describe('sichtbareDatensaetze', () => {
  const treffer = (id: string): Treffer => ({
    befehl: { id, gruppe: 'datensaetze', label: id, ausfuehren: () => {} },
    score: 1,
    stufe: 2,
  });
  const person7 = treffer('datensatz:personen:7');
  const schaden8 = treffer('datensatz:schaeden:8');
  const etb12 = treffer('datensatz:etb:12');
  const sichtbar = (t: Treffer[], modus: PaletteModus, rest: string) =>
    sichtbareDatensaetze(t, modus, rest).map((x) => x.befehl.id);

  /**
   * Als PAAR unter und über der Schwelle; sonst wäre auch eine Funktion grün, die immer leer
   * liefert.
   */
  it('hält anstehende Treffer unter zwei Zeichen zurück, ab zwei Zeichen nicht', () => {
    expect(sichtbar([person7], 'kraefte', 'm')).toEqual([]);
    expect(sichtbar([person7], 'kraefte', 'me')).toEqual(['datensatz:personen:7']);
  });

  /** Der Aktionen-Modus führt keine Quelle, die Menge ist leer. */
  it('verwirft im Aktionen-Modus jeden anstehenden Treffer', () => {
    expect(sichtbar([person7, etb12], 'aktionen', 'meier')).toEqual([]);
  });

  /**
   * Gefiltert wird über die QUELLENMENGE, nicht über „zeigt Datensätze“; sonst überlebte ein
   * Nachläufer den Wechsel '@' → '#'.
   */
  it('lässt je Modus genau die Quellen des Modus stehen', () => {
    const alle = [person7, schaden8, etb12];
    expect(sichtbar(alle, 'kraefte', 'meier')).toEqual(['datensatz:personen:7']);
    expect(sichtbar(alle, 'etb', 'meier')).toEqual(['datensatz:etb:12']);
    expect(sichtbar(alle, 'alles', 'meier')).toEqual(alle.map((t) => t.befehl.id));
  });

  /**
   * Der ETB-Nachläufer fällt bei rein nicht-alphanumerischer Eingabe weg, die übrigen Quellen
   * NICHT: '??' kann in einem Ortsnamen oder Meldungstext stehen.
   */
  it('verwirft den ETB-Nachläufer ohne alphanumerisches Token, die übrigen Quellen nicht', () => {
    expect(sichtbar([person7, etb12], 'alles', '??')).toEqual(['datensatz:personen:7']);
    expect(sichtbar([person7, etb12], 'alles', 'no')).toEqual([
      'datensatz:personen:7',
      'datensatz:etb:12',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/** Lageberichte, Gefahrengebiete, Abschnitte und der ETB-Sammeltreffer; Fixturen als Teilobjekte. */
const lagebericht = (o: Partial<LageberichtAnzeige>): LageberichtAnzeige =>
  ({
    id: 1,
    einsatz_id: 5,
    titel: 'Deichlage',
    version: 1,
    vorgaenger_id: null,
    ...o,
  }) as LageberichtAnzeige;
const gebiet = (o: Partial<Gefahrengebiet>): Gefahrengebiet =>
  ({ id: 1, einsatz_id: 5, label: 'Deichbruch Nord', zonen_ids: [], ...o }) as Gefahrengebiet;
const abschnitt = (o: Partial<Einsatzabschnitt>): Einsatzabschnitt =>
  ({ id: 1, einsatz_id: 5, name: 'Deich Süd', ...o }) as Einsatzabschnitt;

describe('baueDatensatzTreffer — Lageberichte, Gefahrengebiete, Einsatzabschnitte (LFH-619)', () => {
  it('findet alle drei im Vorgabemodus und springt auf ihre Adressen', () => {
    const navigate = vi.fn();
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'deich',
        navigate,
        quellen: {
          lageberichte: [lagebericht({ id: 7 })],
          gefahrengebiete: [gebiet({ id: 3 })],
          abschnitte: [abschnitt({ id: 4 })],
        },
      }),
    );
    expect(labels(t)).toEqual([
      'Lageberichte · Deichlage',
      'Gefahren · Deichbruch Nord',
      'Einsatzabschnitte · Deich Süd',
    ]);
    for (const x of t) x.befehl.ausfuehren();
    expect(navigate.mock.calls.map((c) => c[0])).toEqual([
      '/einsaetze/5/lageberichte/7',
      '/einsaetze/5/gefahren?gefahrengebiet=3',
      '/einsaetze/5/einsatzabschnitte?abschnitt=4',
    ]);
  });

  it('zeigt von einem fortgeschriebenen Lagebericht nur den jüngsten Stand', () => {
    // Zwei Fassungen desselben Berichts wären zwei gleichnamige Zeilen, eine davon veraltet (wie
    // `kettenKoepfe` in der Lageberichte-Liste).
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'deich',
        quellen: {
          lageberichte: [
            lagebericht({ id: 1, version: 1 }),
            lagebericht({ id: 2, version: 2, vorgaenger_id: 1 }),
          ],
        },
      }),
    );
    expect(ids(t)).toEqual(['datensatz:lageberichte:2']);
  });

  it('ein Gefahrengebiet ohne Namen heisst wie auf der Gefahrenseite', () => {
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'gefahrengebiet',
        quellen: { gefahrengebiete: [gebiet({ id: 9, label: null })] },
      }),
    );
    expect(t.map((x) => x.befehl.label)).toEqual(['Gefahrengebiet #9']);
  });

  it('keine der drei gehört in „@" (Namen) oder „#" (Tagebuch)', () => {
    const quellen = {
      lageberichte: [lagebericht({})],
      gefahrengebiete: [gebiet({})],
      abschnitte: [abschnitt({})],
    };
    for (const modus of ['kraefte', 'etb'] as PaletteModus[]) {
      expect(baueDatensatzTreffer(kontext({ suche: 'deich', modus, quellen })), modus).toEqual([]);
    }
  });

  it('ein ausgeblendetes Modul liefert keine Treffer — je Modul, nicht alles oder nichts', () => {
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'deich',
        overrides: {
          gefahrenzonen: ueberschreibung({ modul_key: 'gefahrenzonen', sichtbar: false }),
        },
        quellen: { gefahrengebiete: [gebiet({})], abschnitte: [abschnitt({})] },
      }),
    );
    expect(labels(t)).toEqual(['Einsatzabschnitte · Deich Süd']);
  });
});

describe('baueDatensatzTreffer — ETB-Sammeltreffer (LFH-619)', () => {
  it('eine Zeile mit der Trefferzahl, die auf die gefilterte ETB-Seite springt', () => {
    const navigate = vi.fn();
    const t = baueDatensatzTreffer(
      kontext({ suche: 'deich', navigate, quellen: { etbAnzahl: { anzahl: 31 } } }),
    );
    expect(ids(t)).toEqual(['datensatz:etb:suche']);
    expect(t[0].befehl.label).toBe('Alle Einträge zu „deich“');
    expect(t[0].befehl.kontext).toBe('ETB · 31 Treffer');
    t[0].befehl.ausfuehren();
    expect(new URL(navigate.mock.calls[0][0], 'http://x').searchParams.get('q')).toBe('deich');
    expect(new URL(navigate.mock.calls[0][0], 'http://x').pathname).toBe('/einsaetze/5/etb');
  });

  it('steht HINTER den einzelnen Einträgen — er ist der Weg zu allen, nicht der beste', () => {
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'deich',
        quellen: { etbText: [etb({ id: 4, inhalt: 'Deich hält' })], etbAnzahl: { anzahl: 12 } },
      }),
    );
    expect(ids(t)).toEqual(['datensatz:etb:4', 'datensatz:etb:suche']);
  });

  it('bleibt auch in der SICHTBAREN Ordnung hinter einem Einzeltreffer der Stufe 3', () => {
    // Die Array-Reihenfolge ist nicht die sichtbare, `ordneTreffer` sortiert neu. Bei einer
    // Mehrwortsuche liegt jeder Einzeltreffer auf Stufe 3; der Sammeltreffer muss dahinter stehen.
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'deich nord',
        quellen: {
          etbText: [etb({ id: 4, inhalt: 'Lage am Deich Nord unverändert' })],
          etbAnzahl: { anzahl: 3 },
        },
      }),
    );
    expect(ordneTreffer(t, 'deich nord').map((b) => b.id)).toEqual([
      'datensatz:etb:4',
      'datensatz:etb:suche',
    ]);
  });

  it('„1 Treffer" im Singular, keine Zeile bei null Treffern', () => {
    const eins = baueDatensatzTreffer(
      kontext({ suche: 'deich', quellen: { etbAnzahl: { anzahl: 1 } } }),
    );
    expect(eins[0].befehl.kontext).toBe('ETB · 1 Treffer');
    expect(
      baueDatensatzTreffer(kontext({ suche: 'deich', quellen: { etbAnzahl: { anzahl: 0 } } })),
    ).toEqual([]);
  });

  it('im „#"-Modus ja, im „@"-Modus nein, bei einer Nummer nie', () => {
    const quellen = { etbAnzahl: { anzahl: 5 } };
    expect(ids(baueDatensatzTreffer(kontext({ suche: 'deich', modus: 'etb', quellen })))).toEqual([
      'datensatz:etb:suche',
    ]);
    expect(baueDatensatzTreffer(kontext({ suche: 'deich', modus: 'kraefte', quellen }))).toEqual(
      [],
    );
    // '42' fragt der ETB über den Cursor, nicht über den Volltext.
    expect(baueDatensatzTreffer(kontext({ suche: '42', quellen }))).toEqual([]);
  });

  it('ohne ETB-Recht gibt es ihn nicht', () => {
    const t = baueDatensatzTreffer(
      kontext({
        suche: 'deich',
        overrides: { etb: ueberschreibung({ modul_key: 'etb', sichtbar: false }) },
        quellen: { etbAnzahl: { anzahl: 5 } },
      }),
    );
    expect(t).toEqual([]);
  });

  it('der Riegel an der Anzeige hält ihn wie jeden ETB-Treffer', () => {
    // Nachläufer aus dem warmen Cache: '@deich' zeigt keine ETB-Zeilen, '??' keine
    // Volltext-Zeile, auch nicht den Sammeltreffer.
    const t = baueDatensatzTreffer(
      kontext({ suche: 'deich', quellen: { etbAnzahl: { anzahl: 5 } } }),
    );
    expect(sichtbareDatensaetze(t, 'kraefte', 'deich')).toEqual([]);
    expect(sichtbareDatensaetze(t, 'alles', '??')).toEqual([]);
    expect(ids(sichtbareDatensaetze(t, 'etb', 'deich'))).toEqual(['datensatz:etb:suche']);
  });

  it('ein Sammeltreffer für einen ÄLTEREN Begriff wird nicht angezeigt', () => {
    // Beim Weitertippen von „deich“ zu „deichbruch“ darf der Sammeltreffer des alten Begriffs nicht
    // stehen bleiben.
    const t = baueDatensatzTreffer(
      kontext({ suche: 'deich', quellen: { etbAnzahl: { anzahl: 5 } } }),
    );
    expect(sichtbareDatensaetze(t, 'alles', 'deichbruch')).toEqual([]);
    expect(ids(sichtbareDatensaetze(t, 'alles', ' deich '))).toEqual(['datensatz:etb:suche']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Öffnungsart und Vorschau (LFH-645)', () => {
  function trefferAllerArten(navigate = vi.fn()) {
    return baueDatensatzTreffer(
      kontext({
        suche: 'flor',
        navigate,
        quellen: {
          personen: [person({ id: 11, name: 'Florian' })],
          uhs: [uhs({ id: 12, bezeichnung: 'Florian-Platz' })],
          fahrzeuge: [fahrzeug({ id: 13, funkrufname: 'Florian 1' })],
          personal: [personal({ id: 14, name: 'Florian' })],
          einheiten: [einheit({ id: 15, name: 'Florian SEG' })],
          etbText: [etb({ id: 16, inhalt: 'Florian meldet' })],
          etbAnzahl: { anzahl: 3 },
        },
      }),
    );
  }

  it('jede Datensatzzeile trägt ihr Ziel und reicht die Öffnungsart durch', () => {
    const navigate = vi.fn();
    const t = trefferAllerArten(navigate);
    // Sechs Einzeltreffer plus der ETB-Sammeltreffer — sonst prüfte der Guard weniger.
    expect(t).toHaveLength(7);
    for (const { befehl: b } of t) {
      expect(b.ziel, b.id).toBeDefined();
      navigate.mockClear();
      b.ausfuehren('neuerTab');
      expect(navigate, b.id).toHaveBeenCalledWith(b.ziel, 'neuerTab');
    }
  });

  it('↵ bleibt beim bisherigen Aufruf mit nur dem Pfad', () => {
    const navigate = vi.fn();
    const p = trefferAllerArten(navigate).find((x) => x.befehl.id === 'datensatz:personen:11')!;
    p.befehl.ausfuehren();
    expect(navigate).toHaveBeenCalledWith(p.befehl.ziel);
  });

  /**
   * DER VORSCHAU-GUARD: jede Datensatzquelle hat einen Eintrag, exhaustiv über `DatensatzQuelle`;
   * eine neue Quelle bricht den Typcheck. `null` („keine Vorschau“) steht allein beim
   * Sammeltreffer (`etbAnzahl`).
   */
  const ERWARTETE_ART: Record<DatensatzQuelle, string | null> = {
    personen: 'person',
    schaeden: 'schaden',
    uhs: 'uhs',
    meldungen: 'meldung',
    auftraege: 'auftrag',
    fahrzeuge: 'fahrzeug',
    personal: 'personal',
    einheiten: 'einheit',
    etbNummer: 'etb',
    etbText: 'etb',
    etbAnzahl: null,
    lageberichte: 'lagebericht',
    gefahrengebiete: 'gefahrengebiet',
    abschnitte: 'abschnitt',
  };
  /** Je Quelle EIN Datensatz mit eigener id — die id sagt, aus welcher Quelle der Treffer kommt. */
  function trefferJeQuelle(): Map<number, { quelle: DatensatzQuelle; befehl: Befehl }> {
    const textTreffer = baueDatensatzTreffer(
      kontext({
        suche: 'flor',
        quellen: {
          personen: [person({ id: 101, name: 'Florian' })],
          schaeden: [schaden({ id: 102, ort: 'Florianstr' })],
          uhs: [uhs({ id: 103, bezeichnung: 'Florian-Platz' })],
          meldungen: [meldung({ id: 104, lfd_nr: 4, absender: 'Florian 2' })],
          auftraege: [auftrag({ id: 105, lfd_nr: 5, auftrag_text: 'Florian erkunden' })],
          fahrzeuge: [fahrzeug({ id: 106, funkrufname: 'Florian 1' })],
          personal: [personal({ id: 107, name: 'Florian' })],
          einheiten: [einheit({ id: 108, name: 'Florian SEG' })],
          etbText: [etb({ id: 110, lfd_nr: 10, inhalt: 'Florian ist da' })],
          etbAnzahl: { anzahl: 3 },
          lageberichte: [lagebericht({ id: 111, titel: 'Florian-Lage' })],
          gefahrengebiete: [gebiet({ id: 112, label: 'Florian-Gebiet' })],
          abschnitte: [abschnitt({ id: 113, name: 'Florian Süd' })],
        },
      }),
    );
    // Der Zahlenzweig antwortet nur auf eine Nummer — eigener Aufruf.
    const nummerTreffer = baueDatensatzTreffer(
      kontext({ suche: '9', quellen: { etbNummer: [etb({ id: 109, lfd_nr: 9 })] } }),
    );
    const quelleVon: Record<number, DatensatzQuelle> = {
      101: 'personen',
      102: 'schaeden',
      103: 'uhs',
      104: 'meldungen',
      105: 'auftraege',
      106: 'fahrzeuge',
      107: 'personal',
      108: 'einheiten',
      109: 'etbNummer',
      110: 'etbText',
      111: 'lageberichte',
      112: 'gefahrengebiete',
      113: 'abschnitte',
    };
    const je = new Map<number, { quelle: DatensatzQuelle; befehl: Befehl }>();
    for (const { befehl } of [...textTreffer, ...nummerTreffer]) {
      const m = /^datensatz:[^:]+:(\d+)$/.exec(befehl.id);
      if (!m) continue;
      const id = Number(m[1]);
      je.set(id, { quelle: quelleVon[id], befehl });
    }
    return je;
  }

  it('jede Datensatzquelle trägt ihre Vorschau mit Sorte, Einsatz und id', () => {
    const je = trefferJeQuelle();
    // Alle dreizehn Einzeldatensätze sind angekommen — sonst prüfte der Guard weniger.
    expect([...je.keys()].sort()).toEqual([
      101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113,
    ]);
    for (const [id, { quelle, befehl }] of je) {
      const art = ERWARTETE_ART[quelle];
      const erwartet =
        art === 'etb'
          ? { art, einsatzId: 5, id, lfdNr: id === 109 ? 9 : 10 }
          : { art, einsatzId: 5, id };
      expect(befehl.vorschau, quelle).toEqual(erwartet);
    }
  });

  // Die Gegenaussage für den Koordinatensprung steht in `koordinatenSprung.test.ts`.
  it('der ETB-Sammeltreffer trägt keine Vorschau', () => {
    const sammel = trefferAllerArten().find((x) => x.befehl.id === 'datensatz:etb:suche');
    expect(sammel).toBeDefined();
    expect(sammel!.befehl.vorschau).toBeUndefined();
    expect(ERWARTETE_ART.etbAnzahl).toBeNull();
  });
});
