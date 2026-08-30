// frontend/src/command-palette/CommandPalette.test.tsx
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPalette } from './CommandPalette';
import type { Befehl } from './typen';

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
