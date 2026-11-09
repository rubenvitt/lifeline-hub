/**
 * Zustand des offenen Kontextmenüs eines Datensatzes (LLH-1599, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/lor2qhep-kontextmenue-tabellen/design.md` D1): ein Menü je Fläche, die Zeile
 * je Render frisch, Schließen bei Wegfall.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import type { MenueEintrag } from './MenueAusloeser';
import { useDatensatzKontextMenue } from './useDatensatzKontextMenue';

interface Stelle {
  id: number;
  name: string;
}

const A: Stelle = { id: 1, name: 'Leitstelle Nord' };
const B: Stelle = { id: 2, name: 'Polizei Süd' };

const STANDARD = (): MenueEintrag[] => [
  { key: 'bearbeiten', label: 'Bearbeiten' },
  { key: 'deaktivieren', label: 'Deaktivieren', gefahr: true },
];

function Probe({
  zeilen,
  eintraege = STANDARD,
  onWahl = () => {},
  onOffen,
}: {
  zeilen: Stelle[];
  eintraege?: (s: Stelle) => readonly MenueEintrag[];
  onWahl?: (key: string, s: Stelle) => void;
  onOffen?: (offen: boolean) => void;
}) {
  const { ausloeser, menue, offen } = useDatensatzKontextMenue<Stelle>({
    finde: (k) => zeilen.find((s) => s.id === k),
    schluessel: (s) => s.id,
    eintraege,
    zugaenglicherName: (s) => `Aktionen zu ${s.name}`,
    onWahl,
  });
  onOffen?.(offen);
  return (
    <ul>
      {zeilen.map((s) => (
        <li key={s.id} data-testid={`zeile-${s.id}`} {...ausloeser(s)}>
          {s.name}
        </li>
      ))}
      {menue}
    </ul>
  );
}

const offenesMenue = () =>
  document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label^="Aktionen zu"]',
  );
const kontextAnker = () => document.querySelector('[data-lfh="datensatz-kontextmenue-anker"]');

describe('useDatensatzKontextMenue (LLH-1599, D1)', () => {
  it('Rechtsklick öffnet das Menü der Zeile; die Wahl ruft `onWahl` einmal und schließt', async () => {
    const onWahl = vi.fn();
    const onOffen = vi.fn();
    renderMitProviders(<Probe zeilen={[A, B]} onWahl={onWahl} onOffen={onOffen} />);

    expect(fireEvent.contextMenu(screen.getByTestId('zeile-2'), { button: 2 })).toBe(false);
    const menue = await waitFor(() => offenesMenue()!);
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Polizei Süd');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Bearbeiten', 'Deaktivieren']);
    expect(onOffen).toHaveBeenLastCalledWith(true);

    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Deaktivieren' }));
    expect(onWahl).toHaveBeenCalledTimes(1);
    expect(onWahl).toHaveBeenCalledWith('deaktivieren', B);
    await waitFor(() => expect(kontextAnker()).toBeNull());
    expect(onOffen).toHaveBeenLastCalledWith(false);
  });

  it('ohne Einträge bleibt das Browsermenü', () => {
    renderMitProviders(<Probe zeilen={[A]} eintraege={() => []} />);
    expect(fireEvent.contextMenu(screen.getByTestId('zeile-1'), { button: 2 })).toBe(true);
    expect(kontextAnker()).toBeNull();
  });

  it('verschwindet die Zeile, schließt das offene Menü', async () => {
    const { rerender } = renderMitProviders(<Probe zeilen={[A, B]} />);
    fireEvent.contextMenu(screen.getByTestId('zeile-2'), { button: 2 });
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    rerender(<Probe zeilen={[A]} />);
    await waitFor(() => expect(kontextAnker()).toBeNull());
  });

  it('verliert die Zeile alle Einträge, schließt das offene Menü', async () => {
    const { rerender } = renderMitProviders(<Probe zeilen={[A]} />);
    fireEvent.contextMenu(screen.getByTestId('zeile-1'), { button: 2 });
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    rerender(<Probe zeilen={[A]} eintraege={() => []} />);
    await waitFor(() => expect(kontextAnker()).toBeNull());
  });

  it('die Einträge kommen je Render frisch (Live-Daten, Rechte)', async () => {
    const { rerender } = renderMitProviders(<Probe zeilen={[A]} />);
    fireEvent.contextMenu(screen.getByTestId('zeile-1'), { button: 2 });
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    rerender(<Probe zeilen={[A]} eintraege={() => [{ key: 'aktivieren', label: 'Aktivieren' }]} />);
    await waitFor(() =>
      expect(
        within(offenesMenue()!)
          .getAllByRole('menuitem')
          .map((e) => e.textContent),
      ).toEqual(['Aktivieren']),
    );
  });
});
