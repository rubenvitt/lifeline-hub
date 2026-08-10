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
