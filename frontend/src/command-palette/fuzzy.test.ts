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
 * Der Korpus mit den ECHTEN Schlagworten der Schnellaktion (befehle.ts: `SCHNELLAKTIONEN`,
 * Zeile `personen`). Gemessen gegen fuse.js 7.5.0: für 'etb' liefert Fuse `modul:etb` mit
 * 8.60e-9 und `aktion:personen` mit 5.77e-1 — der zweite ist reines Rauschen (kein Wort des
 * Labels und kein Schlagwort hat mit ETB zu tun), steht aber in der Gruppe, die die
 * kuratierte Startordnung nach vorn zieht. Genau diese Konstellation ordnet die Palette
 * heute falsch, und sie ist der Grund für den Sortierschlüssel weiter unten.
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
   * `includeScore` ist in fuse.js per Vorgabe AUS — ohne die Option liefert `search` das
   * Feld gar nicht erst, nicht bloss einen ignorierten Wert. Die Rangfolge unten kann also
   * nur so gut sein wie diese eine Option.
   *
   * Die TRAGENDE Hälfte ist der Grössenvergleich, nicht die Formprüfung darüber: `filtereBefehle`
   * fängt ein fehlendes `score` mit `?? 0` ab (Fuse typisiert es optional), die Form bliebe also
   * auch ohne die Option `number`. Gemessen bei zurückgedrehtem `includeScore` färbt sich genau
   * die Ungleichung rot („expected 0 to be less than 0"), die Formzeile nicht.
   */
  it('reicht den Fuse-Score hoch, und der genaue Treffer trägt den kleineren', () => {
    const treffer = filtereBefehle(rangKorpus, 'etb');
    expect(treffer.map((t) => typeof t.score)).toEqual(['number', 'number']);
    const score = new Map(treffer.map((t) => [t.befehl.id, t.score]));
    expect(score.get('modul:etb')!).toBeLessThan(score.get('aktion:personen')!);
  });

  /**
   * WARUM {@link UNBEWERTET} genau 1 ist und keine kleinere Zahl (Review-Befund zu C).
   *
   * Ein Datensatz-Treffer ist nie durch Fuse gelaufen und bekommt deshalb den schlechtesten
   * denkbaren Score, damit er auf gleicher Stufe gegen jeden BEWERTETEN Befehl verliert. Das
   * trägt nur, wenn kein Fuse-Score ihn erreicht — und der Abstand ist kleiner, als er
   * aussieht: fuse.js deckelt den Bitap-Score zwar auf `threshold` (0,4), potenziert ihn in
   * `computeScore` aber mit `weight * norm`, und `norm` ist `1/sqrt(Tokenzahl)`. Bei einem
   * langen Feld geht der Exponent gegen 0, und `0,4^x` geht damit gegen 1.
   *
   * Gemessen an fuse.js 7.5.0: ein Tippfehler auf einem 400-Wort-Label liefert 0,973 — ein
   * Deckel bei 0,9 hätte den Datensatz vor diesen Befehl gestellt. Strikt unter 1 bleibt es
   * trotzdem in jedem Fall, weil der Exponent strikt positiv ist.
   *
   * Die zwei Hälften gehören zusammen: die untere Schranke widerlegt jeden kleineren Wert,
   * die obere belegt, dass 1 als Deckel hält. (Mutationsprobe: `UNBEWERTET = 0.9` färbt die
   * erste rot.)
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
 * Die Stufe ist der Präfixbonus, den Fuse NICHT liefert: mit `threshold: 0.4` und
 * `ignoreLocation` bewertet Fuse einen Präfix nicht besonders — das Akzeptanzkriterium
 * „exakter Präfixtreffer vor unscharfem Treffer" ist mit Fuse allein nicht erfüllbar.
 *
 * BLINDFLECK, bewusst: `praefixStufe` faltet keine Diakritika. 'einsaetze' gegen
 * 'Einsätze' trägt weiterhin allein Fuse und bleibt Stufe 3.
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
   * Im Suchfeld wird klein getippt, die Labels tragen Grossbuchstaben (e2e tippt
   * 'lagekarte' gegen das Label 'Lagekarte'). Vergliche die Stufe zeichengenau, griffe
   * KEINE der drei Stufen im Normalbetrieb — der ganze Bonus liefe leer, und die
   * Bestandstests sind ordnungsagnostisch (`toContain`), es fiele niemandem auf.
   */
  it('vergleicht ohne Rücksicht auf Groß-/Kleinschreibung', () => {
    expect(praefixStufe(lagekarte, 'lagekarte')).toBe(0);
    expect(praefixStufe(lagekarte, 'LAGE')).toBe(1);
    expect(praefixStufe(b('a', 'Neuer ETB-Eintrag', ['Tagebuch']), 'tage')).toBe(2);
  });
});

/**
 * Die Stufenrechnung über einen NACKTEN Text (LFH-391 · C1). `praefixStufe` ist seither ihr
 * Aufrufer für Label und Schlagworte; ein zweiter Aufrufer sind die Datensatz-Treffer, die
 * ihre Stufe aus dem Basislabel OHNE Modulherkunft rechnen (siehe `datensaetze.ts`).
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
   * Die Aussage, um die es in A3 geht: der gruppenübergreifend beste Treffer steht vorn.
   * Ohne Score-Achse ordnet allein `GRUPPEN_REIHENFOLGE` — und die stellt die
   * Schnellaktion (Rauschen, 5.77e-1) vor den genauen Modultreffer (8.60e-9).
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
   * Gruppenrang als TIEBREAK, nicht als Primärachse: bei gleichwertigen Treffern bleibt die
   * kuratierte Ordnung aus LFH-337 · M11 erhalten (`schnellaktionen` vor `module`).
   */
  it('entscheidet Gleichstand über den Gruppenrang', () => {
    const treffer: Treffer[] = [
      { befehl: b('m', 'ETB', undefined, 'module'), score: 0.1 },
      { befehl: b('s', 'ETB', undefined, 'schnellaktionen'), score: 0.1 },
    ];
    expect(ordneTreffer(treffer, 'zzz').map((x) => x.id)).toEqual(['s', 'm']);
  });

  /** Und darunter der Eingabeindex — erst damit ist der Schlüssel total. */
  it('hält bei gleichem Rang die Eingabereihenfolge', () => {
    const treffer: Treffer[] = [
      { befehl: b('erst', 'ETB', undefined, 'module'), score: 0.1 },
      { befehl: b('zweit', 'ETB', undefined, 'module'), score: 0.1 },
    ];
    expect(ordneTreffer(treffer, 'zzz').map((x) => x.id)).toEqual(['erst', 'zweit']);
  });

  /**
   * PAAR zur Regel darunter (LFH-391 · C1): ein Treffer, der NICHT durch Fuse gelaufen ist,
   * bringt seine Stufe selbst mit — sonst rechnete `ordneTreffer` sie aus einem Label, das
   * mit der Fundstelle nichts zu tun haben muss (Datensatz-Treffer, ETB-Volltext).
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
 * Der `>`-Präfixmodus (LFH-391 · A4) — ein reiner GRUPPENFILTER, keine zweite Suchachse.
 *
 * Der Parser hat genau EINE Aufrufstelle (`CommandPalette.tsx`); die Zerlegung selbst ist
 * hier ohne Render prüfbar. Getrimmt wird zweimal und aus zwei Gründen: aussen, damit ein
 * führendes Leerzeichen das Präfix nicht verdeckt, und hinter dem Präfixzeichen, damit
 * '> lage' und '>lage' dasselbe bedeuten — auf dem Berührungsweg tippt niemand fugenlos.
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

  /** Ein Präfixzeichen MITTEN im Text ist Suchtext, kein Modus — sonst zerschnitte ein '>'
   *  in einem Suchbegriff die Eingabe. */
  it('erkennt ein Präfixzeichen nur am Anfang', () => {
    expect(parsePraefix('a>b')).toEqual({ modus: 'alles', rest: 'a>b' });
  });

  /**
   * Wächst mit Etappe C: sobald dort '#'/'@' in `PALETTE_MODI` stehen, deckt diese Aussage
   * sie mit ab. `modiMitPraefix` ist zugleich die einzige Quelle, aus der Parser UND
   * Legende lesen — ein Modus, der in der einen, aber nicht in der anderen auftaucht, ist
   * damit strukturell ausgeschlossen.
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

  /** Die Gegenaussage: ohne Präfix schränkt nichts ein. Ohne sie wäre auch ein Filter grün,
   *  der IMMER auf zwei Gruppen kürzt. */
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
   * BEIDE Gedächtnisgruppen fallen bei aktiver Suche weg (LFH-391 · Etappe D), aus demselben
   * Grund: `ausgefuehrt:nav:profil` ist eine Kopie von `nav:profil` mit gleichem Label,
   * gleicher Ikone und gleichem Ziel — flach gerendert stünde „Profil, Profil" da, für
   * Vorlesende zweimal derselbe Name ohne Hinweis, warum. Die Rangfolge leistet bei aktiver
   * Suche ohnehin, wofür die Gruppe da ist.
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

  /** Die Gegenaussage: es fällt NUR diese eine Gruppe weg. Ohne sie wäre auch ein Filter
   *  grün, der die Liste auf „module" verengte — und `schnellaktionen` gingen mit. */
  it('rührt keine andere Gruppe an', () => {
    expect(ohneOrdnungsdubletten(modusKorpus).map((x) => x.id)).toEqual([
      'aktion:speichern',
      'schnell:person',
      'modul:personen',
      'einstellung:dunkel',
    ]);
  });
});
