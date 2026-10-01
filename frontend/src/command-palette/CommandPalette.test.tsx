import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPalette } from './CommandPalette';
import type { Treffer } from './fuzzy';
import type { Befehl, PaletteModus } from './typen';

function befehl(
  id: string,
  label: string,
  ausfuehren = () => {},
  gruppe: Befehl['gruppe'] = 'module',
): Befehl {
  return { id, gruppe, label, ausfuehren };
}

describe('CommandPalette', () => {
  it('filtert die Liste per Sucheingabe', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={[befehl('a', 'ETB'), befehl('b', 'Lagekarte')]}
        schliesse={() => {}}
      />,
    );
    await u.type(screen.getByRole('combobox'), 'lage');
    expect(screen.queryByText('ETB')).not.toBeInTheDocument();
    expect(screen.getByText('Lagekarte')).toBeInTheDocument();
  });

  it('führt den aktiven Befehl per Enter aus und schließt', async () => {
    const u = userEvent.setup();
    const aus = vi.fn();
    const schliesse = vi.fn();
    renderMitProviders(
      <CommandPalette befehle={[befehl('a', 'ETB', aus)]} schliesse={schliesse} />,
    );
    await u.keyboard('{Enter}');
    expect(aus).toHaveBeenCalledTimes(1);
    expect(schliesse).toHaveBeenCalledTimes(1);
  });

  it('bewegt die Auswahl mit Pfeiltasten', async () => {
    const u = userEvent.setup();
    const zweit = vi.fn();
    renderMitProviders(
      <CommandPalette
        befehle={[befehl('a', 'Erstes'), befehl('b', 'Zweites', zweit)]}
        schliesse={() => {}}
      />,
    );
    await u.keyboard('{ArrowDown}{Enter}');
    expect(zweit).toHaveBeenCalledTimes(1);
  });

  it('führt bei modifiziertem Enter keinen Treffer aus', async () => {
    const u = userEvent.setup();
    const aus = vi.fn();
    const schliesse = vi.fn();
    renderMitProviders(
      <CommandPalette befehle={[befehl('a', 'ETB', aus)]} schliesse={schliesse} />,
    );

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
 * Der Korpus trägt die ECHTEN Schlagworte der Schnellaktion. Fuse bewertet für 'etb' den
 * Modulbefehl weit besser als die Schnellaktion (Rauschen); in Gruppenreihenfolge stünde das
 * Rauschen vorn, weil `schnellaktionen` vor `module` steht.
 */
const rangKorpus: Befehl[] = [
  {
    id: 'modul:etb',
    gruppe: 'module',
    label: 'ETB',
    schlagworte: ['tagebuch'],
    ausfuehren: () => {},
  },
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

    // Eine Gruppenüberschrift über einer score-sortierten Liste behauptete eine Ordnung, die es
    // nicht gibt.
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });
});

describe('CommandPalette · Startansicht (LFH-337 · M11)', () => {
  it('stellt bei leerer Suche eine Schnellaktion an die erste Stelle', () => {
    // OHNE Tastatur-Aktionen: die Gruppe `aktionen` stünde sonst vor `schnellaktionen` an erster
    // Stelle.
    const befehle: Befehl[] = [
      { id: 'modul:etb', gruppe: 'module', label: 'Einsatztagebuch', ausfuehren: () => {} },
      {
        id: 'aktion:etb',
        gruppe: 'schnellaktionen',
        label: 'Neuer ETB-Eintrag',
        ausfuehren: () => {},
      },
    ];
    renderMitProviders(<CommandPalette befehle={befehle} schliesse={() => {}} />);
    const optionen = screen.getAllByRole('option');
    expect(optionen[0]).toHaveTextContent('Neuer ETB-Eintrag');
    expect(optionen[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('läuft mit ArrowDown geschlossen über die Gruppengrenze hinweg', async () => {
    // Die Gruppierung ist Darstellung, die Navigation bleibt EINE flache Liste.
    const befehle: Befehl[] = [
      { id: 'modul:etb', gruppe: 'module', label: 'Einsatztagebuch', ausfuehren: () => {} },
      {
        id: 'aktion:etb',
        gruppe: 'schnellaktionen',
        label: 'Neuer ETB-Eintrag',
        ausfuehren: () => {},
      },
    ];
    renderMitProviders(<CommandPalette befehle={befehle} schliesse={() => {}} />);
    await userEvent.keyboard('{ArrowDown}');
    const optionen = screen.getAllByRole('option');
    expect(optionen[1]).toHaveTextContent('Einsatztagebuch');
    expect(optionen[1]).toHaveAttribute('aria-selected', 'true');
  });

  /**
   * Gegenaussage zur Score-Ordnung: bei leerer Suche gilt `GRUPPEN_REIHENFOLGE`. `ordneTreffer`
   * mit leerer Suche zu prüfen wäre ein toter Pfad, die Produktion ruft es dann nie.
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
    // jsdom rechnet kein Layout: geprüft wird der gesetzte Inline-WERT. `toHaveStyle` vergliche mit
    // `getComputedStyle`, das jsdom in px auflöst; „relativ gedeckelt“ wäre dann nicht prüfbar.
    const liste = document.getElementById('cmd-liste');
    expect(liste).not.toBeNull();
    expect(liste!.style.maxHeight).toBe('min(60vh, 480px)');
  });
});

/**
 * Der label-gleiche Zwilling: `baueBefehle` erzeugt für ein zuletzt besuchtes Modul ZWEI Befehle
 * mit gleichem Label, Ikone und Ziel. Die Startansicht MUSS die Dopplung behalten (Abkürzung),
 * die Trefferliste darf sie nicht zeigen.
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

    expect(screen.getAllByRole('option').map(optionsText)).toEqual(['Lagekarte', 'Lagemeldungen']);
  });

  it('behält die Abkürzung „Zuletzt" bei LEERER Suche', () => {
    renderMitProviders(<CommandPalette befehle={zwillingsKorpus} schliesse={() => {}} />);

    expect(screen.getAllByRole('option').map(optionsText)).toEqual([
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
  {
    id: 'schnell:person',
    gruppe: 'schnellaktionen',
    label: 'Neue Person erfassen',
    ausfuehren: () => {},
  },
  { id: 'modul:personen', gruppe: 'module', label: 'Personen', ausfuehren: () => {} },
  { id: 'einstellung:dunkel', gruppe: 'einstellungen', label: 'Dunkel', ausfuehren: () => {} },
];

/**
 * Der LESBARE Text einer Option ohne `aria-hidden`-Beiwerk (Enter-Marke, Kontext); beides ist
 * Darstellung, nicht der Name.
 */
function optionsText(o: HTMLElement): string | null {
  const kopie = o.cloneNode(true) as HTMLElement;
  kopie.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return kopie.textContent;
}
const optionsTexte = () => screen.getAllByRole('option').map(optionsText);
const modusZeile = () => document.querySelector('[data-lfh="palette-modus"]');

describe('CommandPalette · Präfixmodus „>" (LFH-391 · A4)', () => {
  /**
   * Die TRAGENDE Hälfte ist die positive („genau diese zwei Gruppen“); die Abwesenheit der
   * Modul-Option allein wäre trivial grün.
   */
  it('lässt bei nacktem „>" genau die Aktions- und die Schnellaktionsgruppe stehen', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), '>');

    expect(optionsTexte()).toEqual(['Speichern', 'Neue Person erfassen']);
    // Der Rest ist leer, also gilt die Startansicht MIT Rahmen, eingeschränkt, nicht umsortiert.
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Aktionen',
      'Schnellaktionen',
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

  /** Gegenprobe mit demselben Suchwort ohne Präfix: erst das Paar zeigt, dass der Modus filtert
   *  und nicht der Suchbegriff. */
  it('findet dasselbe Suchwort ohne Präfix auch im Modul', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'person');

    expect(optionsTexte()).toContain('Personen');
  });
});

/**
 * Die Modusanzeige beantwortet, OB man im Modus ist; ohne sie wäre ein Modus, der die Liste um
 * zwei Drittel kürzt, von einem kaputten Filter nicht zu unterscheiden. Auf dem Berührungsweg
 * sieht niemand die getippte Zeile als Syntax.
 */
describe('CommandPalette · Modusanzeige (LFH-391 · A4)', () => {
  it('zeigt die Legende mit dem Präfixzeichen als Marke dauerhaft in der Fußzeile', () => {
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    // Die Legende steht in der Fußzeile; die Modusanzeige oben nennt nur den AKTIVEN Modus, bei
    // leerem Feld also keinen.
    const fuss = document.querySelector('[data-lfh="palette-fuss"]');
    expect(fuss).toHaveTextContent('zeigt nur Aktionen');
    expect(fuss).toHaveTextContent('sucht im Einsatztagebuch');
    expect(fuss).toHaveTextContent('öffnen');
    // Nur, was funktioniert: kein „im Panel“, und die Koordinate nur mit `koordinatenSprung`
    // (außerhalb eines Einsatzes wäre der Hinweis eine Einladung ins Leere).
    expect(fuss).not.toHaveTextContent('Koordinate');
    expect(fuss).not.toHaveTextContent('Panel');
    expect(modusZeile()).toBeNull();
    // Ein sichtbares Kürzel ist eine Marke, kein Satzzeichen im Fließtext.
    expect(screen.getByText('>', { selector: 'kbd' })).toBeInTheDocument();
  });

  it('nennt den aktiven Modus, sobald das Präfix steht', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), '>person');

    expect(modusZeile()).toHaveTextContent('Nur Aktionen');
  });

  /** Gegenaussage: bei gewöhnlicher Suche kostet die Zeile keinen Platz. */
  it('verschwindet bei gewöhnlicher Suche ohne Präfix', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'person');

    expect(modusZeile()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Datensatz-Treffer kommen als FERTIGE `Treffer` herein, nicht als `Befehl`: ihre `stufe`
 * entsteht in `baueDatensatzTreffer` und ist aus dem Label nicht zurückzurechnen; ein Umweg über
 * `Befehl[]` verlöre sie still.
 */
const datensatz = (
  id: string,
  label: string,
  ausfuehren = () => {},
  stufe: 0 | 1 | 2 | 3 = 0,
): Treffer => ({
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
   * Gegenaussage für den Zwischenzustand: nach dem Leeren des Feldes stehen die Treffer des vorigen
   * Begriffs noch als Prop an (Entprellung). Die Startansicht bleibt trotzdem kuratiert.
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
   * PAAR: die statischen Befehle fallen weg (`gruppen: []`), die Datensatz-Treffer bleiben. Die
   * erste Hälfte allein wäre auch grün, wenn der Modus alles verwürfe.
   *
   * Der Treffer je Zeile stammt aus einer Quelle, die der Modus WIRKLICH führt: ein
   * Personen-Treffer unter '#' wäre nur ein Nachläufer aus dem Cache, und den hält die Anzeige
   * zurück.
   */
  it.each([
    ['#', 'Nur Einsatztagebuch', 'datensatz:etb:7', 'Einsatztagebuch · #12 · Person gemeldet'],
    ['@', 'Nur Personen und Kräfte', 'datensatz:personen:7', 'Personen · R-042 · Person Nord'],
  ])(
    'lässt unter „%s" die statischen Befehle weg und die Datensatz-Treffer stehen',
    async (praefix, hinweis, id, label) => {
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
    },
  );

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
   * Ein Datensatz-Modus mit einem Zeichen läuft per Konstruktion in eine LEERE Liste; „Keine
   * Treffer“ wäre dort von „kaputt“ nicht zu unterscheiden.
   */
  it('sagt im Datensatz-Modus, dass ein Zeichen zu wenig ist', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), '@a');

    expect(screen.getByText(/Mindestens 2 Zeichen/)).toBeInTheDocument();
    expect(screen.queryByText('Keine Treffer')).not.toBeInTheDocument();
  });

  /** Gegenaussage: ab dem zweiten Zeichen ist die Aufforderung weg. */
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
 * Die Riegel an der ANZEIGE, nicht nur am Abruf. Eine `useQuery` mit `enabled: false` liefert
 * weiter ihre zwischengespeicherte Antwort, und der Trefferstand hinkt der Eingabe nach. Die
 * Prop wird hier bewusst FESTGEHALTEN, während sich die Eingabe ändert; genau das ist der
 * Zwischenzustand aus dem Betrieb.
 */
describe('CommandPalette · Riegel an der Anzeige (LFH-391 · C, Review)', () => {
  const personTreffer = [datensatz('datensatz:personen:7', 'Personen · R-042 · Meier')];

  /**
   * PAAR in einem Lauf: '@meier' zeigt den Treffer, das Kürzen auf '@m' nimmt ihn WIEDER WEG. Sonst
   * bestünde die Liste im Kräfte-Modus nur aus einer Ein-Zeichen-Suche über den warmen Cache, und
   * die Aufforderung erschiene nicht, weil sie am leeren Zweig hängt.
   */
  it('nimmt beim Kürzen auf ein Zeichen die anstehenden Datensatz-Treffer zurück', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={modusKorpus}
        datensatzTreffer={personTreffer}
        schliesse={() => {}}
      />,
    );

    await u.type(screen.getByRole('combobox'), '@meier');
    expect(optionsTexte()).toEqual(['Personen · R-042 · Meier']);

    await u.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}');

    expect(screen.queryAllByRole('option')).toEqual([]);
    expect(screen.getByText(/Mindestens 2 Zeichen/)).toBeInTheDocument();
  });

  /**
   * Derselbe Nachläufer im AKTIONEN-Modus führte aus dem Modus heraus (per Enter auf eine
   * Personen-Detailseite unter der Marke „Nur Aktionen“). PAAR mit demselben Suchwort ohne Präfix;
   * `befehle={[]}`, damit kein Fuzzy-Rauschen die Aussage trübt.
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
   * Dieselbe Achse zwischen ZWEI Datensatz-Modi: der Riegel ist die QUELLENMENGE des Modus, sonst
   * überlebte ein Nachläufer jeden Wechsel innerhalb der Datensatz-Modi.
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
   * Das nackte Präfix: wer es aus der Legende übernimmt, hat noch keine Suche gestellt; „Keine
   * Treffer“ beantwortete eine Frage, die niemand gestellt hat.
   */
  it.each(['@', '#'])(
    'fordert bei nacktem „%s" zum Weitertippen auf, statt Treffer zu verneinen',
    async (praefix) => {
      const u = userEvent.setup();
      renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

      await u.type(screen.getByRole('combobox'), praefix);

      expect(screen.getByText(/Mindestens 2 Zeichen/)).toBeInTheDocument();
      expect(screen.queryByText('Keine Treffer')).not.toBeInTheDocument();
    },
  );

  /**
   * Gegenaussage: '>' ist KEIN Datensatz-Modus. Ohne sie wäre auch eine Aufforderung grün, die in
   * jedem leeren Zustand steht.
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
 * Die Leerzustandszeile erreicht assistive Technik nur aus einer Region, die SCHON DA WAR:
 * `aria-live` meldet nur Änderungen an vorhandenem Inhalt. Ohne sie wäre für Vorlesende „zu
 * kurz“ von „nichts gefunden“ nicht zu unterscheiden.
 */
describe('CommandPalette · Leerzustand als Live-Region (LFH-391 · C, Review)', () => {
  const region = () => document.querySelector('[data-lfh="palette-leerzustand"]');

  /**
   * Die tragende Hälfte: die Region steht im Baum, BEVOR es etwas zu melden gibt. Ein Test, der
   * nur `aria-live` am sichtbaren Text prüft, sähe eine zusammen eingehängte Region nicht.
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

  /** Derselbe Ort trägt die zweite Meldung, kein zweiter Zweig daneben. */
  it('meldet „Keine Treffer" in derselben Region', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={modusKorpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'zzzz');

    expect(region()).toHaveTextContent('Keine Treffer');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die Auswahl hängt an der Befehls-ID: nachrückende Datensatz-Treffer auf Stufe 0 schieben die
 * markierte Zeile nach unten, ein Index markierte dann ohne Zutun eine andere (WCAG 3.2.5). Mit
 * AKTIVER Suche geprüft, weil es nur dort Datensatz-Treffer gibt.
 */
describe('CommandPalette · Auswahl beim Nachrücken (LFH-391 · C3)', () => {
  const module = [
    befehl('modul:lagekarte', 'Lagekarte'),
    befehl('modul:lagemeldungen', 'Lagemeldungen'),
  ];

  it('hält die Auswahl auf demselben Befehl, wenn Datensatz-Treffer nachrücken', async () => {
    const u = userEvent.setup();
    const { rerender } = renderMitProviders(
      <CommandPalette befehle={module} datensatzTreffer={[]} schliesse={() => {}} />,
    );

    await u.type(screen.getByRole('combobox'), 'lage');
    await u.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Lagemeldungen' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

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

    // Die zwei Nummerntreffer stehen jetzt VOR den Modulzeilen; die Marke wandert mit.
    expect(optionsTexte().slice(0, 2)).toEqual([
      'Personen · R-042 · Lage Nord',
      'Schäden · S-042 · Lagerhalle',
    ]);
    expect(screen.getByRole('option', { name: 'Lagemeldungen' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  /** Gegenaussage: ein neuer Suchbegriff setzt die Auswahl auf die erste Zeile zurück. */
  it('setzt die Auswahl bei einem neuen Suchbegriff auf die erste Zeile zurück', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette befehle={module} datensatzTreffer={[]} schliesse={() => {}} />,
    );

    await u.type(screen.getByRole('combobox'), 'lage');
    await u.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Lagemeldungen' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await u.type(screen.getByRole('combobox'), 'k');

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die Entprellung der Meldung nach außen, Bauform und Frist wie in `etb/EtbFilterleiste.tsx`. Sie
 * liegt am Eingabefeld: Text und Fuzzy-Filter reagieren SOFORT, nur die Meldung wartet.
 *
 * Tippen unter Fake-Timern über `fireEvent.change`: `userEvent.type` kommt dort nicht voran und
 * endet im Timeout.
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
      // Vor Ablauf der Frist ist nichts hinausgegangen; sonst wäre die Entprellung bloß eine
      // Verzögerung des LETZTEN Zeichens.
      expect(melde).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(melde.mock.calls.length).toBeLessThanOrEqual(2);
      expect(melde).toHaveBeenLastCalledWith('alles', 'brandausbruch');
    } finally {
      vi.useRealTimers();
    }
  });

  /** Gegenaussage: die sichtbare Liste hängt NICHT an der Frist, sonst wirkte das Feld hängend. */
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

  /** Das Präfix wird EINMAL zerlegt: nach außen geht das Paar, nicht die rohe Eingabe. */
  it('meldet Modus und Rest getrennt, nicht die rohe Eingabe', () => {
    vi.useFakeTimers();
    try {
      const melde = vi.fn<(m: PaletteModus, r: string) => void>();
      renderMitProviders(
        <CommandPalette befehle={modusKorpus} onSucheEntprellt={melde} schliesse={() => {}} />,
      );
      tippe(screen.getByRole('combobox'), '@meier');

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(melde).toHaveBeenLastCalledWith('kraefte', 'meier');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Koordinatensprung: die Palette bekommt eine FUNKTION über den lebenden Rest, weil der
 * entprellte Stand nachhinkt. Geprüft wird die Anzeige: wo die Zeile steht, wann sie fehlt, was
 * Enter tut.
 */
describe('CommandPalette · Koordinatensprung (LFH-619)', () => {
  const karte = vi.fn();
  const sprung = (rest: string): Befehl | null =>
    /^\d+\.\d+, \d+\.\d+$/.test(rest)
      ? {
          id: `koordinate:${rest}`,
          gruppe: 'koordinate',
          label: `Auf Lagekarte zeigen · ${rest}`,
          ausfuehren: karte,
        }
      : null;

  it('stellt die Kartenzeile an die Spitze, und Enter springt', async () => {
    const u = userEvent.setup();
    karte.mockClear();
    renderMitProviders(
      <CommandPalette
        // Ein Modul, dessen Label die getippte Zahl enthält — es darf die Zeile nicht verdrängen.
        befehle={[befehl('m', 'Messpunkt 52.52, 13.41')]}
        // Ein gewöhnlicher Texttreffer (Stufe 3); ein exakter stünde zu Recht vorn, siehe unten.
        datensatzTreffer={[datensatz('datensatz:personen:1', 'Person 52.52, 13.41', () => {}, 3)]}
        koordinatenSprung={sprung}
        schliesse={() => {}}
      />,
    );
    await u.type(screen.getByRole('combobox'), '52.52, 13.41');

    const zeilen = screen.getAllByRole('option');
    expect(zeilen[0]).toHaveTextContent('Auf Lagekarte zeigen · 52.52, 13.41');
    await u.keyboard('{Enter}');
    expect(karte).toHaveBeenCalledTimes(1);
  });

  it('ein exakter Datensatztreffer (Stufe 0) steht VOR der Kartenzeile', async () => {
    // Eine Eingabe, die genau einen Datensatz benennt, meint den Datensatz; die Kartenzeile steht
    // dahinter.
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={[]}
        datensatzTreffer={[datensatz('datensatz:personen:1', 'Person 52.52, 13.41', () => {}, 0)]}
        koordinatenSprung={sprung}
        schliesse={() => {}}
      />,
    );
    await u.type(screen.getByRole('combobox'), '52.52, 13.41');
    const zeilen = screen.getAllByRole('option');
    expect(zeilen[0]).toHaveTextContent('Person 52.52, 13.41');
    expect(zeilen[1]).toHaveTextContent('Auf Lagekarte zeigen');
  });

  it('fehlt in einem Präfixmodus — dort ist die Eingabe kein Ort', async () => {
    const u = userEvent.setup();
    const aufgerufen = vi.fn(sprung);
    renderMitProviders(
      <CommandPalette befehle={[]} koordinatenSprung={aufgerufen} schliesse={() => {}} />,
    );
    await u.type(screen.getByRole('combobox'), '@52.52, 13.41');

    expect(screen.queryByText(/Auf Lagekarte zeigen/)).not.toBeInTheDocument();
  });

  it('fehlt, sobald die Eingabe keine Koordinate mehr ist', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette befehle={[]} koordinatenSprung={sprung} schliesse={() => {}} />,
    );
    const feld = screen.getByRole('combobox');
    await u.type(feld, '52.52, 13.41');
    expect(screen.getByText(/Auf Lagekarte zeigen/)).toBeInTheDocument();
    await u.type(feld, 'x');
    expect(screen.queryByText(/Auf Lagekarte zeigen/)).not.toBeInTheDocument();
  });

  it('die Fußzeile nennt den Weg nur, wenn es den Sprung gibt', () => {
    renderMitProviders(
      <CommandPalette befehle={[]} koordinatenSprung={sprung} schliesse={() => {}} />,
    );
    const fuss = document.querySelector('[data-lfh="palette-fuss"]');
    expect(fuss).toHaveTextContent('Koordinate → Lagekarte');
    // `#` bleibt das ETB-Präfix.
    expect(fuss).toHaveTextContent('sucht im Einsatztagebuch');
    expect(fuss).not.toHaveTextContent('Panel');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Adresszeile (LFH-638): steht am ENDE und ist nie vorausgewählt — ↵ öffnet weiter den besten
 * Treffer; nur wer sie wählt, sucht auf der Lagekarte.
 */
describe('CommandPalette · Adresszeile (LFH-638)', () => {
  const karte = vi.fn();
  const adresse = (rest: string): Befehl | null =>
    rest.trim().length >= 3
      ? {
          id: `adresse:${rest}`,
          gruppe: 'ortssuche',
          label: `Adresse auf Lagekarte suchen · „${rest}“`,
          ausfuehren: karte,
        }
      : null;

  it('steht hinter jedem Treffer; ↵ öffnet den ersten, nicht die Adresssuche', async () => {
    const u = userEvent.setup();
    karte.mockClear();
    const modul = vi.fn();
    renderMitProviders(
      <CommandPalette
        befehle={[befehl('m', 'Hauptstraßen-Plan', modul)]}
        datensatzTreffer={[datensatz('datensatz:personen:1', 'Person Hauptstraße', () => {}, 3)]}
        adressSprung={adresse}
        schliesse={() => {}}
      />,
    );
    await u.type(screen.getByRole('combobox'), 'Hauptstraße');
    const zeilen = screen.getAllByRole('option');
    expect(zeilen[zeilen.length - 1]).toHaveTextContent(
      'Adresse auf Lagekarte suchen · „Hauptstraße“',
    );
    expect(zeilen.length).toBeGreaterThan(1);
    await u.keyboard('{Enter}');
    expect(karte).not.toHaveBeenCalled();
  });

  it('auch allein ist sie wählbar', async () => {
    const u = userEvent.setup();
    karte.mockClear();
    renderMitProviders(<CommandPalette befehle={[]} adressSprung={adresse} schliesse={() => {}} />);
    await u.type(screen.getByRole('combobox'), 'Rathausplatz');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await u.keyboard('{Enter}');
    expect(karte).toHaveBeenCalledTimes(1);
  });

  it('fehlt in einem Präfixmodus', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={[]} adressSprung={adresse} schliesse={() => {}} />);
    await u.type(screen.getByRole('combobox'), '#Rathausplatz');
    expect(screen.queryByText(/Adresse auf Lagekarte suchen/)).not.toBeInTheDocument();
  });
});
