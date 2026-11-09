import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { useKartenKontext } from './useKartenKontext';
import type { KartenAktion } from './kartenKontext';

const offenesMenue = () =>
  document.querySelector<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');

function Karte({ aktionen }: { aktionen: KartenAktion[] }) {
  const { ausloeser, menue } = useKartenKontext({
    aktionen,
    zugaenglicherName: 'Aktionen zu Meldung 7',
  });
  return (
    <article data-testid="karte" {...ausloeser}>
      <span data-testid="text">Wortlaut</span>
      <button type="button">Knopf</button>
      {menue}
    </article>
  );
}

function MitUmschalter({ aktionen }: { aktionen: KartenAktion[] }) {
  const [mit, setMit] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setMit(false)}>
        Rechte weg
      </button>
      <Karte aktionen={mit ? aktionen : []} />
    </>
  );
}

const rechtsklick = (el: Element) =>
  fireEvent.contextMenu(el, { clientX: 20, clientY: 30, button: 2 });

describe('useKartenKontext (LLH-1598, D2)', () => {
  it('Rechtsklick öffnet ein Menü mit allen Aktionen, Gefahr hinter dem Trenner', async () => {
    renderMitProviders(
      <Karte
        aktionen={[
          { key: 'weg', label: 'Löschen', gefahr: true, onWahl: () => {} },
          { key: 'b', label: 'Bestätigen', onWahl: () => {} },
          { key: 's', label: 'Sichten', onWahl: () => {} },
        ]}
      />,
    );
    expect(rechtsklick(screen.getByTestId('text'))).toBe(false);
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue()!;
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Meldung 7');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Bestätigen', 'Sichten', 'Löschen']);
    expect(menue.querySelector('.ant-dropdown-menu-item-divider')).not.toBeNull();
  });

  it('ohne Aktion bleibt das Browsermenü', () => {
    renderMitProviders(<Karte aktionen={[]} />);
    expect(rechtsklick(screen.getByTestId('text'))).toBe(true);
    expect(offenesMenue()).toBeNull();
  });

  it('Wahl ruft die Aktion genau einmal und klickt nicht die Karte', async () => {
    const onWahl = vi.fn();
    const beiKlick = vi.fn();
    renderMitProviders(<Karte aktionen={[{ key: 'b', label: 'Bestätigen', onWahl }]} />);
    screen.getByTestId('karte').addEventListener('click', beiKlick);
    rechtsklick(screen.getByTestId('text'));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(within(offenesMenue()!).getByRole('menuitem', { name: 'Bestätigen' }));
    expect(onWahl).toHaveBeenCalledTimes(1);
    expect(beiKlick).not.toHaveBeenCalled();
  });

  it('Rückfrage im Dialog: erst die Bestätigung löst aus', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <Karte
        aktionen={[
          {
            key: 'ab',
            label: 'Abnehmen',
            onWahl,
            rueckfrage: { titel: 'Auftrag abnehmen?', knopf: 'Auftrag abnehmen' },
          },
        ]}
      />,
    );
    rechtsklick(screen.getByTestId('text'));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(within(offenesMenue()!).getByRole('menuitem', { name: 'Abnehmen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Auftrag abnehmen?').length).toBeGreaterThan(0);
    expect(onWahl).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auftrag abnehmen' }));
    expect(onWahl).toHaveBeenCalledTimes(1);
  });

  it('Abbrechen in der Rückfrage löst nichts aus', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <Karte
        aktionen={[
          {
            key: 'ab',
            label: 'Abnehmen',
            onWahl,
            rueckfrage: { titel: 'Auftrag abnehmen?', knopf: 'Auftrag abnehmen' },
          },
        ]}
      />,
    );
    rechtsklick(screen.getByTestId('text'));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(within(offenesMenue()!).getByRole('menuitem', { name: 'Abnehmen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(onWahl).not.toHaveBeenCalled();
  });

  it('Umschalt+F10 auf einem Knopf der Karte öffnet das Menü', async () => {
    renderMitProviders(<Karte aktionen={[{ key: 'b', label: 'Bestätigen', onWahl: () => {} }]} />);
    const knopf = screen.getByRole('button', { name: 'Knopf' });
    knopf.focus();
    expect(fireEvent.keyDown(knopf, { key: 'F10', shiftKey: true })).toBe(false);
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
  });

  it('verliert die Karte alle Aktionen, schließt das Menü', async () => {
    renderMitProviders(
      <MitUmschalter aktionen={[{ key: 'b', label: 'Bestätigen', onWahl: () => {} }]} />,
    );
    rechtsklick(screen.getByTestId('text'));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Rechte weg' }));
    await waitFor(() => expect(offenesMenue()).toBeNull());
  });
});
