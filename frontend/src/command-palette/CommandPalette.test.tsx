// frontend/src/command-palette/CommandPalette.test.tsx
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPalette } from './CommandPalette';
import type { Treffer } from './fuzzy';
import type { Befehl, PaletteModus } from './typen';

function befehl(id: string, label: string, ausfuehren = () => {}, gruppe: Befehl['gruppe'] = 'module'): Befehl {
  return { id, gruppe, label, ausfuehren };
}

describe('CommandPalette', () => {
  it('filtert die Liste per Sucheingabe', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette befehle={[befehl('a', 'ETB'), befehl('b', 'Lagekarte')]} schliesse={() => {}} />,
    );
    await u.type(screen.getByRole('combobox'), 'lage');
    expect(screen.queryByText('ETB')).not.toBeInTheDocument();
    expect(screen.getByText('Lagekarte')).toBeInTheDocument();
  });

  it('führt den aktiven Befehl per Enter aus und schließt', async () => {
    const u = userEvent.setup();
    const aus = vi.fn();
    const schliesse = vi.fn();
    renderMitProviders(<CommandPalette befehle={[befehl('a', 'ETB', aus)]} schliesse={schliesse} />);
    await u.keyboard('{Enter}');
    expect(aus).toHaveBeenCalledTimes(1);
    expect(schliesse).toHaveBeenCalledTimes(1);
  });

  it('bewegt die Auswahl mit Pfeiltasten', async () => {
    const u = userEvent.setup();
    const zweit = vi.fn();
    renderMitProviders(
      <CommandPalette befehle={[befehl('a', 'Erstes'), befehl('b', 'Zweites', zweit)]} schliesse={() => {}} />,
    );
    await u.keyboard('{ArrowDown}{Enter}');
    expect(zweit).toHaveBeenCalledTimes(1);
  });

  it('führt bei modifiziertem Enter keinen Treffer aus', async () => {
    const u = userEvent.setup();
    const aus = vi.fn();
    const schliesse = vi.fn();
    renderMitProviders(<CommandPalette befehle={[befehl('a', 'ETB', aus)]} schliesse={schliesse} />);

    await u.keyboard('{Control>}{Enter}{/Control}');

    expect(aus).not.toHaveBeenCalled();
    expect(schliesse).not.toHaveBeenCalled();
  });

  it('navigiert und bestätigt während einer IME-Komposition keinen Treffer', () => {
    const erstes = vi.fn();
    const zweites = vi.fn();
    const schliesse = vi.fn();
    renderMitProviders(
      <CommandPalette
        befehle={[befehl('a', 'Erstes', erstes), befehl('b', 'Zweites', zweites)]}
        schliesse={schliesse}
      />,
    );
    const eingabe = screen.getByRole('combobox');

    fireEvent.keyDown(eingabe, { key: 'ArrowDown', isComposing: true });
    fireEvent.keyDown(eingabe, { key: 'Enter', isComposing: true });

    expect(screen.getByRole('option', { name: 'Erstes' })).toHaveAttribute('aria-selected', 'true');
    expect(erstes).not.toHaveBeenCalled();
    expect(zweites).not.toHaveBeenCalled();
    expect(schliesse).not.toHaveBeenCalled();
  });

  it('zeigt das Tastaturkürzel eines Befehls semantisch an', () => {
    renderMitProviders(
      <CommandPalette
        befehle={[{ ...befehl('a', 'Speichern'), kuerzel: 'Strg + S' }]}
        schliesse={() => {}}
      />,
    );

    expect(screen.getByText('Strg + S', { selector: 'kbd' })).toBeInTheDocument();
  });

  it('überlässt Escape dem globalen Dispatcher statt Ant Design', async () => {
    const u = userEvent.setup();
    const schliesse = vi.fn();
    renderMitProviders(<CommandPalette befehle={[befehl('a', 'ETB')]} schliesse={schliesse} />);

    await u.keyboard('{Escape}');

    expect(schliesse).not.toHaveBeenCalled();
  });
});

/**
 * Der Korpus trägt die ECHTEN Schlagworte der Schnellaktion (befehle.ts: `SCHNELLAKTIONEN`).
 * Gemessen gegen fuse.js 7.5.0 bewertet Fuse für 'etb' den Modulbefehl mit 8.60e-9 und die
 * Schnellaktion mit 5.77e-1 — letzteres ist Rauschen (weder Label noch Schlagwort hat mit ETB
 * zu tun). Weil `schnellaktionen` in `GRUPPEN_REIHENFOLGE` vor `module` steht, stand das
 * Rauschen bis A3 an erster Stelle.
 */
const rangKorpus: Befehl[] = [
  { id: 'modul:etb', gruppe: 'module', label: 'ETB', schlagworte: ['tagebuch'], ausfuehren: () => {} },
  {
    id: 'aktion:personen',
    gruppe: 'schnellaktionen',
    label: 'Neue Person erfassen',
    schlagworte: ['registrieren', 'vermisst', 'betroffen', 'patient'],
    ausfuehren: () => {},
  },
];

describe('CommandPalette · Rangfolge bei aktiver Suche (LFH-391 · A3)', () => {
  it('stellt den gruppenübergreifend besten Treffer an die erste Stelle', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={rangKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'etb');

    const optionen = screen.getAllByRole('option');
    expect(optionen[0]).toHaveTextContent('ETB');
    expect(optionen[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('rendert bei aktiver Suche flach, ohne Gruppenrahmen', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={rangKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'etb');

    // Eine Gruppenüberschrift über einer score-sortierten Liste behauptete eine Ordnung,
    // die es dann nicht mehr gibt — die Treffer stehen quer zu den Gruppen.
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });
});

describe('CommandPalette · Startansicht (LFH-337 · M11)', () => {
  it('stellt bei leerer Suche eine Schnellaktion an die erste Stelle', () => {
    // OHNE Tastatur-Aktionen: die Gruppe `aktionen` (TASTATUR_AKTIONEN) steht
    // unverändert vor `schnellaktionen` und wäre sonst die erste — das Ticket
    // verlangt nur `schnellaktionen` vor `module`, `aktionen` bleibt unangetastet.
    const befehle: Befehl[] = [
      { id: 'modul:etb', gruppe: 'module', label: 'Einsatztagebuch', ausfuehren: () => {} },
      { id: 'aktion:etb', gruppe: 'schnellaktionen', label: 'Neuer ETB-Eintrag', ausfuehren: () => {} },
    ];
    renderMitProviders(<CommandPalette befehle={befehle} schliesse={() => {}} />);
    const optionen = screen.getAllByRole('option');
    expect(optionen[0]).toHaveTextContent('Neuer ETB-Eintrag');
    expect(optionen[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('läuft mit ArrowDown geschlossen über die Gruppengrenze hinweg', async () => {
    // B7: die Gruppierung ist Darstellung, die Navigation bleibt EINE flache Liste.
    const befehle: Befehl[] = [
      { id: 'modul:etb', gruppe: 'module', label: 'Einsatztagebuch', ausfuehren: () => {} },
      { id: 'aktion:etb', gruppe: 'schnellaktionen', label: 'Neuer ETB-Eintrag', ausfuehren: () => {} },
    ];
    renderMitProviders(<CommandPalette befehle={befehle} schliesse={() => {}} />);
    await userEvent.keyboard('{ArrowDown}');
    const optionen = screen.getAllByRole('option');
    expect(optionen[1]).toHaveTextContent('Einsatztagebuch');
    expect(optionen[1]).toHaveAttribute('aria-selected', 'true');
  });

  /**
   * Die GEGENAUSSAGE zur Score-Ordnung (LFH-391 · A3): bei leerer Suche gilt weiterhin
   * `GRUPPEN_REIHENFOLGE`. Ohne diese Hälfte gäbe A3 die kuratierte Startansicht still auf
   * statt bewusst — und sie ist die schärfere: `ordneTreffer` mit leerer Suche zu prüfen
   * wäre ein toter Pfad, die Produktion ruft die Funktion dann nie.
   */
  it('behält bei leerer Suche die Gruppenrahmen', () => {
    renderMitProviders(<CommandPalette befehle={rangKorpus} schliesse={() => {}} />);
    expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Neue Person erfassen');
  });

  it('deckelt die Listenhöhe relativ statt auf 380 px', () => {
    const befehle: Befehl[] = [
      { id: 'modul:etb', gruppe: 'module', label: 'Einsatztagebuch', ausfuehren: () => {} },
    ];
    renderMitProviders(<CommandPalette befehle={befehle} schliesse={() => {}} />);
    // jsdom rechnet kein Layout — prüfbar ist der gesetzte WERT, nicht die Pixelhöhe.
    expect(document.getElementById('cmd-liste')).toHaveStyle({
      maxHeight: 'min(60vh, 480px)',
    });
  });
});

/**
 * Der label-gleiche Zwilling (LFH-391 · A3, Review-Befund). `baueBefehle` erzeugt für ein
 * zuletzt besuchtes Modul ZWEI Befehle mit gleichem Label, gleicher Ikone und gleichem
 * Ziel — im Gruppenzweig trennen sie die Überschriften „Zuletzt" und „Module", flach nicht
 * mehr. Beide Hälften gehören zusammen: die Startansicht MUSS die Dopplung behalten
 * (sie ist dort die Abkürzung, LFH-337 · H12), die Trefferliste darf sie nicht zeigen.
 */
const zwillingsKorpus: Befehl[] = [
  { id: 'zuletzt:lagekarte', gruppe: 'zuletzt', label: 'Lagekarte', ausfuehren: () => {} },
  { id: 'modul:lagekarte', gruppe: 'module', label: 'Lagekarte', ausfuehren: () => {} },
  { id: 'modul:lagemeldungen', gruppe: 'module', label: 'Lagemeldungen', ausfuehren: () => {} },
];

describe('CommandPalette · label-gleiche Zwillinge (LFH-391 · A3)', () => {
  it('zeigt bei aktiver Suche jeden Treffer genau einmal', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={zwillingsKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'lage');

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Lagekarte',
      'Lagemeldungen',
    ]);
  });

  it('behält die Abkürzung „Zuletzt" bei LEERER Suche', () => {
    renderMitProviders(<CommandPalette befehle={zwillingsKorpus} schliesse={() => {}} />);

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Lagekarte',
      'Lagekarte',
      'Lagemeldungen',
    ]);
    expect(screen.getByRole('group', { name: 'Zuletzt' })).toBeInTheDocument();
  });
});

/** Ein Befehl je Gruppe: nur so ist „genau diese zwei bleiben übrig" eine Aussage. */
const modusKorpus: Befehl[] = [
  { id: 'aktion:speichern', gruppe: 'aktionen', label: 'Speichern', ausfuehren: () => {} },
  { id: 'schnell:person', gruppe: 'schnellaktionen', label: 'Neue Person erfassen', ausfuehren: () => {} },
  { id: 'modul:personen', gruppe: 'module', label: 'Personen', ausfuehren: () => {} },
  { id: 'einstellung:dunkel', gruppe: 'einstellungen', label: 'Dunkel', ausfuehren: () => {} },
];

const optionsTexte = () => screen.getAllByRole('option').map((o) => o.textContent);
const modusZeile = () => document.querySelector('[data-lfh="palette-modus"]');

describe('CommandPalette · Präfixmodus „>" (LFH-391 · A4)', () => {
  /**
   * Die TRAGENDE Hälfte ist die positive: „genau diese zwei Gruppen sind übrig". Die
   * Abwesenheit der Modul-Option allein wäre trivial grün — für die Eingabe '>' fand die
   * Palette auch vorher nichts und zeigte „Keine Treffer".
   */
  it('lässt bei nacktem „>" genau die Aktions- und die Schnellaktionsgruppe stehen', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), '>');

    expect(optionsTexte()).toEqual(['Speichern', 'Neue Person erfassen']);
    // Der Rest ist leer, also gilt weiter die kuratierte Startansicht MIT Rahmen —
    // eingeschränkt, nicht umsortiert.
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Aktionen', 'Schnellaktionen',
    ]);
  });

  /** Gegenaussage zur Zeile darüber: ohne Präfix stehen alle vier Gruppen da. */
  it('zeigt ohne Präfix weiterhin Modul- und Einstellungsbefehle', () => {
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    expect(optionsTexte()).toEqual(['Speichern', 'Neue Person erfassen', 'Personen', 'Dunkel']);
  });

  it('sucht mit „>" nur innerhalb der zwei Gruppen', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), '>person');

    expect(optionsTexte()).toEqual(['Neue Person erfassen']);
  });

  /** Und die Gegenprobe mit demselben Suchwort: ohne Präfix trifft es beide. Erst dieses
   *  Paar zeigt, dass der Modus filtert und nicht der Suchbegriff. */
  it('findet dasselbe Suchwort ohne Präfix auch im Modul', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'person');

    expect(optionsTexte()).toContain('Personen');
  });
});

/**
 * Die Modusanzeige (LFH-391 · A4).
 *
 * Sie ist die Antwort auf zwei Fragen zugleich: WIE komme ich in den Modus (Legende, solange
 * das Feld leer ist) und BIN ich gerade drin (Moduswortlaut, solange er aktiv ist). Ohne die
 * zweite Hälfte ist ein Modus, der eine Liste um zwei Drittel kürzt, von einem kaputten
 * Filter nicht zu unterscheiden — die Palette ist seit LFH-335 auch der Berührungs- und
 * Handschuhweg zu 42+ Befehlen, und dort sieht niemand die getippte Zeile als Syntax.
 */
describe('CommandPalette · Modusanzeige (LFH-391 · A4)', () => {
  it('zeigt bei leerem Feld die Legende mit dem Präfixzeichen als Marke', () => {
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    expect(modusZeile()).toHaveTextContent('zeigt nur Aktionen');
    // Ein sichtbares Kürzel ist eine Marke, kein Satzzeichen im Fließtext (CLAUDE.md,
    // Nacharbeit zu LFH-335): ein nacktes '>' im Text hätte weder Rahmen noch Abstand.
    expect(screen.getByText('>', { selector: 'kbd' })).toBeInTheDocument();
  });

  it('nennt den aktiven Modus, sobald das Präfix steht', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), '>person');

    expect(modusZeile()).toHaveTextContent('Nur Aktionen');
  });

  /** Gegenaussage: bei gewöhnlicher Suche kostet die Zeile keine der rund sieben Zeilen,
   *  die der Fükw-Schirm zeigt. */
  it('verschwindet bei gewöhnlicher Suche ohne Präfix', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'person');

    expect(modusZeile()).toBeNull();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
/**
 * Datensatz-Treffer kommen als FERTIGE `Treffer` herein, nicht als `Befehl` (LFH-391 · C3).
 *
 * Der Plan hatte sie in die `befehle`-Prop gemischt und `filtereBefehle` einen
 * Durchreich-Zweig gegeben. Das geht seit Etappe A nicht mehr: die Trefferstufe
 * (`Treffer.stufe`) ist die Achse, auf der ein exakter Nummerntreffer vor Fuzzy-Rauschen
 * steht — sie entsteht in `baueDatensatzTreffer` und ist aus dem Label NICHT
 * zurückzurechnen. Ein Umweg über `Befehl[]` verlöre sie still, und mit ihr das zentrale
 * Akzeptanzkriterium des Tickets.
 */
const datensatz = (id: string, label: string, ausfuehren = () => {}, stufe: 0 | 1 | 2 | 3 = 0): Treffer => ({
  befehl: { id, gruppe: 'datensaetze', label, ausfuehren },
  score: 0,
  stufe,
});

describe('CommandPalette · Datensatz-Treffer (LFH-391 · C3)', () => {
  it('rendert einen Datensatz-Treffer bei aktiver Suche als Option', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={[befehl('modul:personen', 'Personen')]}
        datensatzTreffer={[datensatz('datensatz:personen:7', 'Personen · R-042 · Müller')]}
        schliesse={() => {}}
      />,
    );

    await u.type(screen.getByRole('combobox'), '42');

    expect(optionsTexte()).toContain('Personen · R-042 · Müller');
  });

  it('führt den Datensatz-Treffer per Enter aus und schließt', async () => {
    const u = userEvent.setup();
    const aus = vi.fn();
    const schliesse = vi.fn();
    renderMitProviders(
      <CommandPalette
        befehle={[]}
        datensatzTreffer={[datensatz('datensatz:personen:7', 'Personen · R-042 · Müller', aus)]}
        schliesse={schliesse}
      />,
    );

    await u.type(screen.getByRole('combobox'), '42');
    await u.keyboard('{Enter}');

    expect(aus).toHaveBeenCalledTimes(1);
    expect(schliesse).toHaveBeenCalledTimes(1);
  });

  /**
   * Die GEGENAUSSAGE, und sie deckt einen echten Zwischenzustand ab: der entprellte Rest
   * hinkt der Eingabe um bis zu 300 ms hinterher. Wer das Feld leert, sieht die Palette
   * sofort wieder in der Startansicht — die Treffer des vorigen Begriffs stehen zu dem
   * Zeitpunkt noch als Prop an. Sie dort zu rendern hiesse, die kuratierte Startansicht
   * (LFH-337 · M11) für eine Drittelsekunde durch eine Datenhalde zu ersetzen.
   */
  it('zeigt bei leerer Suche keinen Datensatz-Treffer, auch wenn noch welche anstehen', () => {
    renderMitProviders(
      <CommandPalette
        befehle={[befehl('modul:personen', 'Personen')]}
        datensatzTreffer={[datensatz('datensatz:personen:7', 'Personen · R-042 · Müller')]}
        schliesse={() => {}}
      />,
    );

    expect(optionsTexte()).toEqual(['Personen']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CommandPalette · Präfixmodi „#" und „@" (LFH-391 · C3)', () => {
  /**
   * PAAR: Die statischen Befehle fallen weg (`gruppen: []`), die Datensatz-Treffer bleiben.
   * Die erste Hälfte allein wäre auch grün, wenn der Modus ALLES verwürfe — dann wäre das
   * Präfix eine Sackgasse statt einer Abkürzung.
   *
   * Der Treffer je Zeile stammt aus einer Quelle, die der Modus WIRKLICH führt (Befund 5):
   * ein Personen-Treffer unter '#' entsteht in der Produktion nie — dort holt `useDatensaetze`
   * nur den ETB —, er wäre ausschliesslich ein Nachläufer aus dem warmen Cache, und genau den
   * hält die Anzeige jetzt zurück. Mit ihm als Fixtur prüfte die Zeile das Gegenteil.
   */
  it.each([
    ['#', 'Nur Einsatztagebuch', 'datensatz:etb:7', 'Einsatztagebuch · #12 · Person gemeldet'],
    ['@', 'Nur Personen und Kräfte', 'datensatz:personen:7', 'Personen · R-042 · Person Nord'],
  ])('lässt unter „%s" die statischen Befehle weg und die Datensatz-Treffer stehen', async (praefix, hinweis, id, label) => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={modusKorpus}
        datensatzTreffer={[datensatz(id, label)]}
        schliesse={() => {}}
      />,
    );

    await u.type(screen.getByRole('combobox'), praefix + 'person');

    expect(optionsTexte()).toEqual([label]);
    expect(modusZeile()).toHaveTextContent(hinweis);
  });

  /** Gegenprobe mit demselben Suchwort: ohne Präfix stehen die statischen Befehle da. */
  it('zeigt dasselbe Suchwort ohne Präfix samt statischer Befehle', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={modusKorpus}
        datensatzTreffer={[datensatz('datensatz:personen:7', 'Personen · R-042 · Person Nord')]}
        schliesse={() => {}}
      />,
    );

    await u.type(screen.getByRole('combobox'), 'person');

    expect(optionsTexte()).toContain('Personen');
    expect(optionsTexte()).toContain('Personen · R-042 · Person Nord');
  });

  /**
   * Ein Datensatz-Modus mit einem einzigen Zeichen läuft per Konstruktion in eine LEERE
   * Liste: die statischen Befehle sind ausgefiltert, die Queries feuern erst ab zwei
   * Zeichen. „Keine Treffer" wäre dort von „kaputt" nicht zu unterscheiden — und auf dem
   * Berührungsweg sieht niemand die getippte Zeile als Syntax.
   */
  it('sagt im Datensatz-Modus, dass ein Zeichen zu wenig ist', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), '@a');

    expect(screen.getByText(/Mindestens 2 Zeichen/)).toBeInTheDocument();
    expect(screen.queryByText('Keine Treffer')).not.toBeInTheDocument();
  });

  /** Gegenaussage: ab dem zweiten Zeichen ist die Aufforderung weg — sonst stünde sie
   *  dauerhaft da und sagte nichts mehr. */
  it('nimmt die Aufforderung ab dem zweiten Zeichen zurück', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={modusKorpus}
        datensatzTreffer={[datensatz('datensatz:personen:7', 'Personen · R-042 · Ab')]}
        schliesse={() => {}}
      />,
    );

    await u.type(screen.getByRole('combobox'), '@ab');

    expect(screen.queryByText(/Mindestens 2 Zeichen/)).not.toBeInTheDocument();
    expect(optionsTexte()).toEqual(['Personen · R-042 · Ab']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die Riegel an der ANZEIGE, nicht nur am Abruf (Review-Befunde 4, 5 und 8 zu Etappe C).
 *
 * Alle drei haben dieselbe Ursache: eine `useQuery` mit `enabled: false` FEUERT nicht,
 * LIEFERT aber weiterhin ihre zwischengespeicherte Antwort — und der Stand, aus dem die
 * Treffer gebaut wurden, hinkt der Eingabe ohnehin um die Entprellungsfrist hinterher. Eine
 * anstehende Trefferliste ist deshalb kein Beleg dafür, dass die aktuelle Eingabe sie
 * rechtfertigt; die Prop wird hier bewusst FESTGEHALTEN, während sich die Eingabe ändert —
 * genau das ist der Zwischenzustand aus dem Betrieb.
 */
describe('CommandPalette · Riegel an der Anzeige (LFH-391 · C, Review)', () => {
  const personTreffer = [datensatz('datensatz:personen:7', 'Personen · R-042 · Meier')];

  /**
   * BEFUND 4, als PAAR in einem Lauf: '@meier' zeigt den Treffer, das Zurücknehmen auf '@m'
   * nimmt ihn WIEDER WEG. Gemessen stand dort bis zu eine Viertelstunde alte Cache-Ausbeute:
   * im Kräfte-Modus sind die statischen Befehle ausgefiltert, die Liste bestand also
   * ausschliesslich aus einer Ein-Zeichen-Suche über den warmen Cache — und die Aufforderung,
   * die genau das erklären sollte, erschien nicht, weil sie am leeren Zweig hängt.
   */
  it('nimmt beim Kürzen auf ein Zeichen die anstehenden Datensatz-Treffer zurück', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette befehle={modusKorpus} datensatzTreffer={personTreffer} schliesse={() => {}} />,
    );

    await u.type(screen.getByRole('combobox'), '@meier');
    expect(optionsTexte()).toEqual(['Personen · R-042 · Meier']);

    await u.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}');

    expect(screen.queryAllByRole('option')).toEqual([]);
    expect(screen.getByText(/Mindestens 2 Zeichen/)).toBeInTheDocument();
  });

  /**
   * BEFUND 5: derselbe Nachläufer im AKTIONEN-Modus. Er ist dort nicht bloss überzählig,
   * sondern führt aus dem Modus heraus — markierbar und per Enter ausführbar landet man auf
   * einer Personen-Detailseite, während die Marke „Nur Aktionen" darüber steht.
   *
   * PAAR mit demselben Suchwort ohne Präfix, sonst misst die Zeile die Schwelle statt des
   * Modus. `befehle={[]}`, damit kein Fuzzy-Rauschen auf 'meier' die Aussage trübt.
   */
  it('zeigt im Aktionen-Modus keinen anstehenden Datensatz-Treffer, ohne Präfix denselben schon', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette befehle={[]} datensatzTreffer={personTreffer} schliesse={() => {}} />,
    );
    const feld = screen.getByRole('combobox');

    await u.type(feld, '>meier');
    expect(screen.queryAllByRole('option')).toEqual([]);
    expect(modusZeile()).toHaveTextContent('Nur Aktionen');

    await u.clear(feld);
    await u.type(feld, 'meier');

    expect(optionsTexte()).toEqual(['Personen · R-042 · Meier']);
  });

  /**
   * Dieselbe Achse zwischen ZWEI Datensatz-Modi: '#' führt den ETB, nicht die Personen. Der
   * Riegel ist deshalb nicht „Modus zeigt überhaupt Datensätze", sondern die QUELLENMENGE
   * des Modus — sonst überlebte ein Nachläufer jeden Wechsel innerhalb der Datensatz-Modi.
   */
  it('lässt unter „#" den ETB-Nachläufer stehen und den Personen-Nachläufer nicht', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={[]}
        datensatzTreffer={[
          ...personTreffer,
          datensatz('datensatz:etb:12', 'Einsatztagebuch · #12 · Meier gemeldet'),
        ]}
        schliesse={() => {}}
      />,
    );

    await u.type(screen.getByRole('combobox'), '#meier');

    expect(optionsTexte()).toEqual(['Einsatztagebuch · #12 · Meier gemeldet']);
  });

  /**
   * BEFUND 8: das nackte Präfix. Wer es aus der Legende übernimmt, hat noch keine Suche
   * gestellt — „Keine Treffer" beantwortet dort eine Frage, die niemand gestellt hat.
   */
  it.each(['@', '#'])('fordert bei nacktem „%s" zum Weitertippen auf, statt Treffer zu verneinen', async (praefix) => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), praefix);

    expect(screen.getByText(/Mindestens 2 Zeichen/)).toBeInTheDocument();
    expect(screen.queryByText('Keine Treffer')).not.toBeInTheDocument();
  });

  /**
   * Gegenaussage zur Zeile darüber, und sie trägt: '>' ist KEIN Datensatz-Modus. Ohne sie
   * wäre auch eine Aufforderung grün, die in jedem leeren Zustand steht — dort ist die Liste
   * wirklich leer und nicht bloss zu kurz gefragt.
   */
  it('bleibt bei nacktem „>" ohne passende Aktion bei „Keine Treffer"', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={[]} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), '>');

    expect(screen.getByText('Keine Treffer')).toBeInTheDocument();
    expect(screen.queryByText(/Mindestens 2 Zeichen/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * BEFUND 7: die Leerzustandszeile erreicht assistive Technik nur aus einer Region, die
 * SCHON DA WAR (Bauform `components/Erfassung.tsx:352` — dort steht die Ansage-Zeile im
 * Serienmodus immer, weil eine `aria-live`-Region nur Änderungen an bereits vorhandenem
 * Inhalt meldet).
 *
 * Ohne sie meldete die Combobox nur den Wechsel auf `aria-expanded=false`: es gibt keine
 * Option und keinen Live-Bereich, aus dem der Satz vorgelesen würde — für Vorlesende ist
 * „zu kurz" damit von „nichts gefunden" nicht zu unterscheiden, also genau die
 * Ununterscheidbarkeit, gegen die die Zeile gebaut wurde.
 */
describe('CommandPalette · Leerzustand als Live-Region (LFH-391 · C, Review)', () => {
  const region = () => document.querySelector('[data-lfh="palette-leerzustand"]');

  /**
   * DIE TRAGENDE HÄLFTE ist die erste: die Region steht im Baum, BEVOR es etwas zu melden
   * gibt. Eine Region, die zusammen mit ihrem Text eingehängt wird, sagt nichts an — und ein
   * Test, der nur das `aria-live` am sichtbaren Text prüft, sähe das nicht.
   */
  it('hält die Region schon bereit, während noch Treffer stehen, und meldet dann darin', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={modusKorpus}
        datensatzTreffer={[datensatz('datensatz:personen:7', 'Personen · R-042 · Meier')]}
        schliesse={() => {}}
      />,
    );

    expect(region(), 'die Region steht vor der ersten Meldung').not.toBeNull();
    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(region()).toHaveTextContent('');

    await u.type(screen.getByRole('combobox'), '@a');

    expect(region()).toHaveTextContent(/Mindestens 2 Zeichen/);
  });

  /** Und derselbe Ort trägt die zweite Meldung — nicht ein zweiter Zweig daneben. */
  it('meldet „Keine Treffer" in derselben Region', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'zzzz');

    expect(region()).toHaveTextContent('Keine Treffer');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die Auswahl hängt an der Befehls-ID, nicht am Listenindex (LFH-391 · C3).
 *
 * Datensatz-Treffer treffen ASYNCHRON ein — 300 ms Entprellung plus Netz. Ein
 * Nummerntreffer trägt die Stufe 0 und steht damit VOR jedem Modultreffer; die markierte
 * Zeile rückt unter dem Cursor nach unten. Mit einem Index-State markiert die Palette dann
 * eine andere Zeile, ohne dass jemand etwas gedrückt hat — derselbe Vertrag wie
 * „Live-Updates springen nicht unter dem Cursor" (WCAG 3.2.5).
 *
 * MIT AKTIVER SUCHE geprüft, und nur so: bei leerer Suche gibt es per Konstruktion nie
 * Datensatz-Treffer (die Queries laufen erst ab zwei Zeichen), das Szenario käme in der
 * Produktion nicht vor.
 */
describe('CommandPalette · Auswahl beim Nachrücken (LFH-391 · C3)', () => {
  const module = [befehl('modul:lagekarte', 'Lagekarte'), befehl('modul:lagemeldungen', 'Lagemeldungen')];

  it('hält die Auswahl auf demselben Befehl, wenn Datensatz-Treffer nachrücken', async () => {
    const u = userEvent.setup();
    const { rerender } = renderMitProviders(
      <CommandPalette befehle={module} datensatzTreffer={[]} schliesse={() => {}} />,
    );

    await u.type(screen.getByRole('combobox'), 'lage');
    await u.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Lagemeldungen' })).toHaveAttribute('aria-selected', 'true');

    rerender(
      <CommandPalette
        befehle={module}
        datensatzTreffer={[
          datensatz('datensatz:personen:7', 'Personen · R-042 · Lage Nord'),
          datensatz('datensatz:schaeden:8', 'Schäden · S-042 · Lagerhalle'),
        ]}
        schliesse={() => {}}
      />,
    );

    // Die zwei Nummerntreffer stehen jetzt VOR den Modulzeilen — die Marke wandert mit.
    expect(optionsTexte().slice(0, 2)).toEqual([
      'Personen · R-042 · Lage Nord', 'Schäden · S-042 · Lagerhalle',
    ]);
    expect(screen.getByRole('option', { name: 'Lagemeldungen' })).toHaveAttribute('aria-selected', 'true');
  });

  /** Gegenaussage: ein neuer Suchbegriff setzt die Auswahl sehr wohl auf die erste Zeile
   *  zurück — ein Merker, der das überlebte, markierte eine Zeile aus der alten Liste. */
  it('setzt die Auswahl bei einem neuen Suchbegriff auf die erste Zeile zurück', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={module} datensatzTreffer={[]} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'lage');
    await u.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Lagemeldungen' })).toHaveAttribute('aria-selected', 'true');

    await u.type(screen.getByRole('combobox'), 'k');

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die Entprellung der Meldung nach aussen (LFH-391 · C3).
 *
 * Bauform und Frist wörtlich aus `etb/EtbFilterleiste.tsx` (ENTPRELLUNG_MS = 300, samt
 * `clearTimeout` im Abbau-Effekt) — ein zweiter Entprellungsmechanismus wäre eine zweite
 * Wahrheit. Sie liegt HIER und nicht im `PaletteHost`, weil nur die Stelle am Eingabefeld
 * die zwei Achsen unterscheidet: der sichtbare Text und der Fuzzy-Filter über die
 * statischen Befehle sind kostenlos und müssen SOFORT reagieren, nur die Meldung wartet.
 *
 * Tippen läuft unter Fake-Timern über `fireEvent.change` — `userEvent.type` kommt dort
 * gemessen nicht voran und endet im Timeout statt in einer Aussage (Kommentar in
 * `EtbFilterleiste.test.tsx`).
 */
function tippe(feld: HTMLElement, text: string) {
  let bisher = '';
  for (const zeichen of text) {
    bisher += zeichen;
    fireEvent.change(feld, { target: { value: bisher } });
  }
}

describe('CommandPalette · Entprellung nach aussen (LFH-391 · C3)', () => {
  it('meldet den Suchbegriff erst nach der Frist — 13 Zeichen ergeben höchstens 2 Meldungen', () => {
    vi.useFakeTimers();
    try {
      const melde = vi.fn<(m: PaletteModus, r: string) => void>();
      renderMitProviders(
        <CommandPalette befehle={modusKorpus} onSucheEntprellt={melde} schliesse={() => {}} />,
      );
      tippe(screen.getByRole('combobox'), 'brandausbruch');
      // Vor Ablauf der Frist ist nichts hinausgegangen — sonst wäre die Entprellung bloss
      // eine Verzögerung des LETZTEN Zeichens und die Zahl bliebe bei 13.
      expect(melde).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(400); });

      expect(melde.mock.calls.length).toBeLessThanOrEqual(2);
      expect(melde).toHaveBeenLastCalledWith('alles', 'brandausbruch');
    } finally {
      vi.useRealTimers();
    }
  });

  /** Die Gegenaussage: die sichtbare Liste hängt NICHT an der Frist. Hinge sie daran, sähe
   *  die Bedienung aus wie ein hängendes Feld — der Fehler, gegen den M80 gebaut wurde. */
  it('filtert die sichtbare Liste sofort, ohne auf die Frist zu warten', () => {
    vi.useFakeTimers();
    try {
      renderMitProviders(
        <CommandPalette befehle={modusKorpus} onSucheEntprellt={vi.fn()} schliesse={() => {}} />,
      );
      const feld = screen.getByRole('combobox');
      tippe(feld, 'dunkel');

      expect(feld).toHaveValue('dunkel');
      expect(optionsTexte()).toEqual(['Dunkel']);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Das Präfix wird EINMAL zerlegt: nach aussen geht das Paar, nicht die rohe Eingabe.
   *  Ein zweiter Parser im `PaletteHost` wäre eine zweite Wahrheit darüber, was „der
   *  Suchbegriff" ist. */
  it('meldet Modus und Rest getrennt, nicht die rohe Eingabe', () => {
    vi.useFakeTimers();
    try {
      const melde = vi.fn<(m: PaletteModus, r: string) => void>();
      renderMitProviders(
        <CommandPalette befehle={modusKorpus} onSucheEntprellt={melde} schliesse={() => {}} />,
      );
      tippe(screen.getByRole('combobox'), '@meier');

      act(() => { vi.advanceTimersByTime(400); });

      expect(melde).toHaveBeenLastCalledWith('kraefte', 'meier');
    } finally {
      vi.useRealTimers();
    }
  });
});
