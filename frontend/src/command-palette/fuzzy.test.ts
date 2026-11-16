import { describe, it, expect } from 'vitest';
import {
  filtereBefehle,
  filtereNachModus,
  modiMitPraefix,
  ohneOrdnungsdubletten,
  ordneTreffer,
  parsePraefix,
  praefixStufe,
  normalisiere,
  textStufe,
  UNBEWERTET,
  type Treffer,
} from './fuzzy';
import type { Befehl, PaletteModus } from './typen';

const b = (
  id: string,
  label: string,
  schlagworte?: string[],
  gruppe: Befehl['gruppe'] = 'module',
): Befehl => ({
  id,
  gruppe,
  label,
  schlagworte,
  ausfuehren: () => {},
});
const liste: Befehl[] = [
  b('modul:etb', 'ETB', ['tagebuch']),
  b('modul:personen', 'Personen', ['vermisst']),
  b('modul:lagekarte', 'Lagekarte'),
];

/**
 * Der Korpus mit den ECHTEN Schlagworten der Schnellaktion `personen`: für 'etb' trifft nur das
 * Modul, die Schnellaktion steht in der Gruppe, die die Startordnung nach vorn zieht.
 */
const rangKorpus: Befehl[] = [
  b('modul:etb', 'ETB', ['tagebuch'], 'module'),
  b(
    'aktion:personen',
    'Person erfassen',
    ['registrieren', 'vermisst', 'betroffen', 'patient', 'Neue Person erfassen'],
    'schnellaktionen',
  ),
];

const ids = (befehle: Befehl[], suche: string) =>
  filtereBefehle(befehle, suche).map((x) => x.befehl.id);

describe('normalisiere', () => {
  it('schreibt klein und Umlaute und ß um', () => {
    expect(normalisiere('Kräfteübersicht')).toBe('kraefteuebersicht');
    expect(normalisiere('Größe')).toBe('groesse');
    expect(normalisiere('ÖFFNEN')).toBe('oeffnen');
  });
  it('nimmt andere Diakritika weg', () => {
    expect(normalisiere('Café')).toBe('cafe');
  });
});

/**
 * Trefferregel (Spec `sprungpalette`, „Ein Treffer braucht Wortanfang oder Teilwort“): jedes
 * Suchwort trifft einen Wortanfang oder, ab drei Zeichen, ein Teilwort; eine Buchstabenfolge
 * trifft nicht.
 */
describe('filtereBefehle', () => {
  const korpus: Befehl[] = [
    ...liste,
    b('modul:kraefteuebersicht', 'Kräfteübersicht', ['Meldebild', 'Stärke']),
    b('modul:uhs', 'Unfallhilfsstellen', ['BHP']),
    b('aktion:etb', 'ETB-Eintrag schreiben', ['tagebuch', 'Neuer ETB-Eintrag'], 'schnellaktionen'),
    b('aktion:gefahr', 'Gefahrengebiet zeichnen', ['gefahr', 'lagekarte'], 'schnellaktionen'),
    b('nav:benutzer', 'Benutzerverwaltung', undefined, 'navigation'),
    b('einstellung:dunkel', 'Dunkel', ['theme', 'hell', 'dunkel'], 'einstellungen'),
    b('modul:fernmeldewesen', 'Fernmeldewesen', ['Funkplan, Skizze, Kommunikationsplan']),
  ];

  it('gibt bei leerer Suche alles zurück', () => {
    expect(filtereBefehle(liste, '   ')).toHaveLength(3);
  });
  it('findet über den Labelanfang', () => {
    expect(ids(liste, 'lage')).toEqual(['modul:lagekarte']);
  });
  it('findet über ein Schlagwort', () => {
    expect(ids(liste, 'tagebuch')).toContain('modul:etb');
  });
  it('lässt eine bloße Buchstabenfolge nicht treffen', () => {
    // „rtw“ steckt als Folge in „lageka(r)(t)e“, „gefahrengebie(t)“ usw.: Fuse traf das.
    expect(ids(korpus, 'rtw')).toEqual([]);
  });
  it('lässt einen Tippfehler nicht treffen', () => {
    expect(ids(liste, 'persanen')).toEqual([]);
  });
  it('trifft „funk“ über den Wortanfang, nicht „Dunkel“', () => {
    expect(ids(korpus, 'funk')).toEqual(['modul:fernmeldewesen']);
  });
  it('setzt Umschrift und Umlaut gleich', () => {
    expect(ids(korpus, 'kraefte')).toContain('modul:kraefteuebersicht');
    expect(ids(korpus, 'kräfte')).toContain('modul:kraefteuebersicht');
    expect(ids(korpus, 'staerke')).toContain('modul:kraefteuebersicht');
  });
  it('trifft ein Teilwort ab drei Zeichen', () => {
    expect(ids(korpus, 'hilfsstelle')).toContain('modul:uhs');
    expect(ids(korpus, 'ersicht')).toContain('modul:kraefteuebersicht');
  });
  it('trifft unter drei Zeichen nur am Wortanfang', () => {
    expect(ids(korpus, 'ar')).toEqual([]);
    expect(ids(korpus, 'bh')).toEqual(['modul:uhs']);
  });
  it('verlangt jedes Suchwort, auch über Label und Schlagworte verteilt', () => {
    expect(ids(korpus, 'neuer etb')).toEqual(['aktion:etb']);
    expect(ids(korpus, 'etb zeichnen')).toEqual([]);
  });

  /** Zweite Ordnungsachse: Label vor Schlagwort, ohne Fuse. */
  it('bewertet einen Treffer im Label besser als einen über Schlagworte', () => {
    const score = new Map(
      filtereBefehle(korpus, 'tagebuch').map((t) => [t.befehl.id, t.score] as const),
    );
    const imLabel = filtereBefehle(korpus, 'etb').find((t) => t.befehl.id === 'modul:etb');
    expect(imLabel?.score).toBe(0);
    expect(score.get('modul:etb')).toBeGreaterThan(0);
    expect(score.get('modul:etb')).toBeLessThan(UNBEWERTET);
  });
});

describe('praefixStufe', () => {
  const lagekarte = b('modul:lagekarte', 'Lagekarte', ['karte', 'lage']);

  it('unterscheidet die vier Stufen', () => {
    expect(praefixStufe(lagekarte, 'Lagekarte')).toBe(0);
    expect(praefixStufe(lagekarte, 'Lage')).toBe(1);
    expect(praefixStufe(b('a', 'Neue Person erfassen'), 'Person')).toBe(2);
    expect(praefixStufe(b('a', 'ETB', ['tagebuch']), 'tage')).toBe(2);
    expect(praefixStufe(b('a', 'Unfallhilfsstellen'), 'hilfsstelle')).toBe(3);
  });

  /**
   * Im Suchfeld wird klein getippt, die Labels tragen Großbuchstaben; zeichengenau griffe keine
   * Stufe, und die ordnungsagnostischen Bestandstests sähen das nicht.
   */
  it('vergleicht ohne Rücksicht auf Groß-/Kleinschreibung', () => {
    expect(praefixStufe(lagekarte, 'lagekarte')).toBe(0);
    expect(praefixStufe(lagekarte, 'LAGE')).toBe(1);
    expect(praefixStufe(b('a', 'Neuer ETB-Eintrag', ['Tagebuch']), 'tage')).toBe(2);
  });

  it('faltet Umlaute auf jeder Stufe', () => {
    expect(praefixStufe(b('a', 'Kräfteübersicht'), 'kraefteuebersicht')).toBe(0);
    expect(praefixStufe(b('a', 'Kräfteübersicht'), 'kraefte')).toBe(1);
    expect(praefixStufe(b('a', 'Einsätze'), 'einsaetze')).toBe(0);
  });

  it('verlangt auf Stufe 2 für jedes Suchwort einen Wortanfang', () => {
    expect(praefixStufe(b('a', 'ETB-Eintrag schreiben', ['Neuer ETB-Eintrag']), 'neuer etb')).toBe(
      2,
    );
    expect(praefixStufe(b('a', 'ETB-Eintrag schreiben'), 'etb reiben')).toBe(3);
  });
});

/**
 * Die Stufenrechnung über einen NACKTEN Text; Aufrufer sind `praefixStufe` und die
 * Datensatz-Treffer (Basislabel ohne Modulherkunft).
 */
describe('textStufe', () => {
  it('unterscheidet dieselben vier Stufen wie praefixStufe', () => {
    expect(textStufe('Lagekarte', 'lagekarte')).toBe(0);
    expect(textStufe('Lagekarte', 'lage')).toBe(1);
    expect(textStufe('R-042 · Müller', 'müller')).toBe(2);
    expect(textStufe('Personen', 'sonen')).toBe(3);
  });
  it('faltet Umlaute', () => {
    expect(textStufe('R-042 · Müller', 'mueller')).toBe(2);
  });
  /** Ein leerer Begriff darf keine Stufe 1 erzeugen — `''.startsWith` ist immer wahr. */
  it('stuft einen leeren Begriff auf 3', () => {
    expect(textStufe('Lagekarte', '   ')).toBe(3);
  });
});

describe('ordneTreffer', () => {
  /**
   * Der gruppenübergreifend beste Treffer steht vorn: auf gleicher Stufe schlägt der Treffer im
   * Label den über ein Schlagwort, auch wenn dessen Gruppe in der Startordnung vorn steht.
   */
  it('stellt den besseren Score vor die kuratierte Gruppenachse', () => {
    const korpus: Befehl[] = [
      b('schlag', 'ETB-Eintrag schreiben', ['Neuer Eintrag'], 'schnellaktionen'),
      b('label', 'Neuer Eintrag', undefined, 'module'),
    ];
    const treffer = filtereBefehle(korpus, 'neuer');
    expect(ordneTreffer(treffer, 'neuer').map((x) => x.id)).toEqual(['label', 'schlag']);
  });

  it('lässt beim Kürzel „etb“ nur das Modul treffen', () => {
    const treffer = filtereBefehle(rangKorpus, 'etb');
    expect(ordneTreffer(treffer, 'etb').map((x) => x.id)).toEqual(['modul:etb']);
  });

  /** Das AK selbst: die Stufe schlägt den Score, nicht umgekehrt. */
  it('stellt den Präfixtreffer vor den besser bewerteten unscharfen Treffer', () => {
    const treffer: Treffer[] = [
      { befehl: b('unscharf', 'Bericht zur Lage'), score: 0.01 },
      { befehl: b('praefix', 'Lagekarte'), score: 0.4 },
    ];
    expect(ordneTreffer(treffer, 'lage').map((x) => x.id)).toEqual(['praefix', 'unscharf']);
  });

  /**
   * Gruppenrang als TIEBREAK: bei gleichwertigen Treffern bleibt die kuratierte Ordnung
   * (`schnellaktionen` vor `module`).
   */
  it('entscheidet Gleichstand über den Gruppenrang', () => {
    const treffer: Treffer[] = [
      { befehl: b('m', 'ETB', undefined, 'module'), score: 0.1 },
      { befehl: b('s', 'ETB', undefined, 'schnellaktionen'), score: 0.1 },
    ];
    expect(ordneTreffer(treffer, 'zzz').map((x) => x.id)).toEqual(['s', 'm']);
  });

  /** Darunter der Eingabeindex, erst damit ist der Schlüssel total. */
  it('hält bei gleichem Rang die Eingabereihenfolge', () => {
    const treffer: Treffer[] = [
      { befehl: b('erst', 'ETB', undefined, 'module'), score: 0.1 },
      { befehl: b('zweit', 'ETB', undefined, 'module'), score: 0.1 },
    ];
    expect(ordneTreffer(treffer, 'zzz').map((x) => x.id)).toEqual(['erst', 'zweit']);
  });

  /**
   * Ein Treffer, der NICHT durch `filtereBefehle` gelaufen ist, bringt seine Stufe selbst mit; sonst rechnete
   * `ordneTreffer` sie aus einem Label, das mit der Fundstelle nichts zu tun haben muss.
   */
  it('respektiert eine mitgelieferte Stufe, statt sie aus dem Label zu rechnen', () => {
    const treffer: Treffer[] = [
      { befehl: b('praefix', 'Lagekarte'), score: 0.4 },
      { befehl: b('vorgabe', 'Völlig anderer Text'), score: 0.4, stufe: 0 },
    ];
    expect(ordneTreffer(treffer, 'lage').map((x) => x.id)).toEqual(['vorgabe', 'praefix']);
  });

  it('rechnet die Stufe weiterhin selbst, wenn keine mitgeliefert ist', () => {
    const treffer: Treffer[] = [
      { befehl: b('ohne', 'Völlig anderer Text'), score: 0.4 },
      { befehl: b('praefix', 'Lagekarte'), score: 0.4 },
    ];
    expect(ordneTreffer(treffer, 'lage').map((x) => x.id)).toEqual(['praefix', 'ohne']);
  });
});

/**
 * Präfixmodi: ein reiner GRUPPENFILTER. Getrimmt wird außen und hinter dem Präfixzeichen, damit
 * '> lage' und '>lage' dasselbe bedeuten (auf dem Berührungsweg tippt niemand fugenlos).
 */
describe('parsePraefix', () => {
  it('trennt Modus und Rest', () => {
    const faelle: [string, PaletteModus, string][] = [
      ['', 'alles', ''],
      ['lage', 'alles', 'lage'],
      ['>', 'aktionen', ''],
      ['>lage', 'aktionen', 'lage'],
      ['> lage', 'aktionen', 'lage'],
      ['  >  lage ', 'aktionen', 'lage'],
      // Nur das ERSTE Zeichen ist Syntax: das zweite '>' ist wieder Suchtext.
      ['>>', 'aktionen', '>'],
    ];
    for (const [eingabe, modus, rest] of faelle) {
      expect(parsePraefix(eingabe), `parsePraefix(${JSON.stringify(eingabe)})`).toEqual({
        modus,
        rest,
      });
    }
  });

  /** Ein Präfixzeichen MITTEN im Text ist Suchtext, sonst zerschnitte ein '>' die Eingabe. */
  it('erkennt ein Präfixzeichen nur am Anfang', () => {
    expect(parsePraefix('a>b')).toEqual({ modus: 'alles', rest: 'a>b' });
  });

  /**
   * `modiMitPraefix` ist die einzige Quelle für Parser UND Legende; ein Modus, der nur in einer
   * von beiden auftaucht, ist strukturell ausgeschlossen.
   */
  it('erreicht jeden Modus mit Präfixzeichen über genau dieses Zeichen', () => {
    const mitPraefix = modiMitPraefix();
    expect(mitPraefix.length).toBeGreaterThan(0);
    for (const { modus, praefix } of mitPraefix) {
      expect(parsePraefix(`${praefix}lage`), praefix).toEqual({ modus, rest: 'lage' });
    }
  });

  /** Die einzeilige Fußzeile nennt jedes Präfix mit Kurzwort (LFH-1055); kein Langtext (LFH-1078). */
  it('führt zu jedem Präfix ein Kurzwort', () => {
    for (const { praefix, kurz } of modiMitPraefix()) {
      expect(kurz, praefix).toBeTruthy();
    }
  });
});

const modusKorpus: Befehl[] = [
  b('aktion:speichern', 'Speichern', undefined, 'aktionen'),
  b('schnell:person', 'Person erfassen', undefined, 'schnellaktionen'),
  b('modul:personen', 'Personen', undefined, 'module'),
  b('einstellung:dunkel', 'Dunkel', undefined, 'einstellungen'),
];

describe('filtereNachModus', () => {
  it('lässt im Modus „aktionen" genau die zwei Aktionsgruppen stehen', () => {
    expect(filtereNachModus(modusKorpus, 'aktionen').map((x) => x.id)).toEqual([
      'aktion:speichern',
      'schnell:person',
    ]);
  });

  /** Gegenaussage: ohne Präfix schränkt nichts ein; sonst wäre auch ein Filter grün, der IMMER
   *  kürzt. */
  it('lässt im Modus „alles" die Liste unverändert', () => {
    expect(filtereNachModus(modusKorpus, 'alles').map((x) => x.id)).toEqual([
      'aktion:speichern',
      'schnell:person',
      'modul:personen',
      'einstellung:dunkel',
    ]);
  });
});

describe('ohneOrdnungsdubletten', () => {
  const mitZuletzt: Befehl[] = [
    b('zuletzt:lagekarte', 'Lagekarte', undefined, 'zuletzt'),
    b('modul:lagekarte', 'Lagekarte', undefined, 'module'),
    b('modul:lagemeldungen', 'Lagemeldungen', undefined, 'module'),
  ];

  it('entfernt die Ordnungsgruppe „zuletzt" und lässt den Modul-Zwilling stehen', () => {
    expect(ohneOrdnungsdubletten(mitZuletzt).map((x) => x.id)).toEqual([
      'modul:lagekarte',
      'modul:lagemeldungen',
    ]);
  });

  /**
   * BEIDE Gedächtnisgruppen fallen bei aktiver Suche weg: `ausgefuehrt:nav:profil` ist eine Kopie
   * von `nav:profil`; flach stünde „Profil, Profil“ da.
   */
  it('entfernt auch die Gedächtnisgruppe „ausgefuehrt" samt ihrem Zwilling-Original', () => {
    const mitGedaechtnis: Befehl[] = [
      b('ausgefuehrt:nav:profil', 'Profil', undefined, 'ausgefuehrt'),
      b('nav:profil', 'Profil', undefined, 'navigation'),
      b('modul:lagekarte', 'Lagekarte', undefined, 'module'),
    ];
    expect(ohneOrdnungsdubletten(mitGedaechtnis).map((x) => x.id)).toEqual([
      'nav:profil',
      'modul:lagekarte',
    ]);
  });

  /** Gegenaussage: es fällt NUR diese Gruppe weg, nicht etwa auch `schnellaktionen`. */
  it('rührt keine andere Gruppe an', () => {
    expect(ohneOrdnungsdubletten(modusKorpus).map((x) => x.id)).toEqual([
      'aktion:speichern',
      'schnell:person',
      'modul:personen',
      'einstellung:dunkel',
    ]);
  });
});
