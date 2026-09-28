import { describe, it, expect } from 'vitest';
import {
  filtereBefehle,
  filtereNachModus,
  modiMitPraefix,
  ohneOrdnungsdubletten,
  ordneTreffer,
  parsePraefix,
  praefixStufe,
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
 * Der Korpus mit den ECHTEN Schlagworten der Schnellaktion `personen`. Für 'etb' bewertet Fuse
 * `modul:etb` weit besser als `aktion:personen` (Rauschen), das aber in der Gruppe steht, die die
 * Startordnung nach vorn zieht; der Grund für den Sortierschlüssel unten.
 */
const rangKorpus: Befehl[] = [
  b('modul:etb', 'ETB', ['tagebuch'], 'module'),
  b(
    'aktion:personen',
    'Neue Person erfassen',
    ['registrieren', 'vermisst', 'betroffen', 'patient'],
    'schnellaktionen',
  ),
];

describe('filtereBefehle', () => {
  it('gibt bei leerer Suche alles zurück', () => {
    expect(filtereBefehle(liste, '   ')).toHaveLength(3);
  });
  it('findet per Substring im Label', () => {
    expect(filtereBefehle(liste, 'lage').map((x) => x.befehl.id)).toContain('modul:lagekarte');
  });
  it('findet per Schlagwort', () => {
    expect(filtereBefehle(liste, 'tagebuch').map((x) => x.befehl.id)).toContain('modul:etb');
  });
  it('toleriert leichte Tippfehler (Fuzzy)', () => {
    expect(filtereBefehle(liste, 'persanen').map((x) => x.befehl.id)).toContain('modul:personen');
  });

  /**
   * `includeScore` ist in fuse.js per Vorgabe AUS. Tragend ist der Größenvergleich, nicht die
   * Formprüfung: `filtereBefehle` fängt ein fehlendes `score` mit `?? 0` ab, die Form bliebe also
   * auch ohne die Option `number`.
   */
  it('reicht den Fuse-Score hoch, und der genaue Treffer trägt den kleineren', () => {
    const treffer = filtereBefehle(rangKorpus, 'etb');
    expect(treffer.map((t) => typeof t.score)).toEqual(['number', 'number']);
    const score = new Map(treffer.map((t) => [t.befehl.id, t.score]));
    expect(score.get('modul:etb')!).toBeLessThan(score.get('aktion:personen')!);
  });

  /**
   * Warum {@link UNBEWERTET} genau 1 ist: fuse.js deckelt den Bitap-Score auf `threshold` (0,4),
   * potenziert ihn aber mit `weight * norm`, und `norm` ist `1/sqrt(Tokenzahl)`. Bei langem Feld
   * geht der Score gegen 1 (ein Tippfehler auf einem 400-Wort-Label liefert rund 0,97), bleibt
   * aber strikt darunter. Die untere Schranke widerlegt jeden kleineren Wert, die obere belegt,
   * dass 1 hält.
   */
  it('kommt bei langem Label nahe an 1 heran, bleibt aber strikt darunter', () => {
    const rauschen = Array.from({ length: 400 }, (_, i) => `wort${i}`).join(' ');
    const treffer = filtereBefehle([b('lang', `${rauschen} etb`)], 'etp');
    expect(
      treffer,
      'Fuse findet das Label trotz Tippfehler — sonst prüft der Test nichts',
    ).toHaveLength(1);
    expect(treffer[0].score).toBeGreaterThan(0.9);
    expect(treffer[0].score).toBeLessThan(UNBEWERTET);
  });
});

/**
 * Die Stufe ist der Präfixbonus, den Fuse nicht liefert. Blindfleck, bewusst: keine
 * Diakritika-Faltung ('einsaetze' gegen 'Einsätze' bleibt Stufe 3).
 */
describe('praefixStufe', () => {
  const lagekarte = b('modul:lagekarte', 'Lagekarte', ['karte', 'lage']);

  it('unterscheidet die vier Stufen', () => {
    expect(praefixStufe(lagekarte, 'Lagekarte')).toBe(0);
    expect(praefixStufe(lagekarte, 'Lage')).toBe(1);
    expect(praefixStufe(b('a', 'Neue Person erfassen'), 'Person')).toBe(2);
    expect(praefixStufe(b('a', 'ETB', ['tagebuch']), 'tage')).toBe(2);
    expect(praefixStufe(b('a', 'Personen'), 'persanen')).toBe(3);
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
    expect(textStufe('Personen', 'persanen')).toBe(3);
  });
  /** Ein leerer Begriff darf keine Stufe 1 erzeugen — `''.startsWith` ist immer wahr. */
  it('stuft einen leeren Begriff auf 3', () => {
    expect(textStufe('Lagekarte', '   ')).toBe(3);
  });
});

describe('ordneTreffer', () => {
  /**
   * Der gruppenübergreifend beste Treffer steht vorn; ohne Score-Achse stünde das Rauschen der
   * Schnellaktion vor dem genauen Modultreffer.
   */
  it('stellt den besseren Score vor die kuratierte Gruppenachse', () => {
    const treffer = filtereBefehle(rangKorpus, 'etb');
    expect(ordneTreffer(treffer, 'etb').map((x) => x.id)).toEqual(['modul:etb', 'aktion:personen']);
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
   * Ein Treffer, der NICHT durch Fuse gelaufen ist, bringt seine Stufe selbst mit; sonst rechnete
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
});

const modusKorpus: Befehl[] = [
  b('aktion:speichern', 'Speichern', undefined, 'aktionen'),
  b('schnell:person', 'Neue Person erfassen', undefined, 'schnellaktionen'),
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
