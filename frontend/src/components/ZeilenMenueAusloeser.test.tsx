/**
 * ⋮ einer Zeile aus ihrer Beschreibung (LLH-1599, `openspec/changes/lor2qhep-kontextmenue-tabellen/
 * design.md` D2): dieselbe Quelle wie das Kontextmenü.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import type { WeitereAktionen } from './Datensicht';
import { ZeilenMenueAusloeser } from './ZeilenMenueAusloeser';

interface Stelle {
  id: number;
  name: string;
}
const S: Stelle = { id: 7, name: 'Leitstelle Nord' };

function menue(extra: Partial<WeitereAktionen<Stelle>> = {}): WeitereAktionen<Stelle> {
  return {
    eintraege: () => [
      { key: 'bearbeiten', label: 'Bearbeiten' },
      { key: 'deaktivieren', label: 'Deaktivieren', gefahr: true },
    ],
    zugaenglicherName: (s) => `Aktionen zu ${s.name}`,
    onWahl: vi.fn(),
    ...extra,
  };
}

describe('ZeilenMenueAusloeser (LLH-1599, D2)', () => {
  it('zeigt das ⋮ aus der Beschreibung; die Wahl geht mit der Zeile an `onWahl`', async () => {
    const m = menue();
    renderMitProviders(<ZeilenMenueAusloeser menue={m} zeile={S} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Leitstelle Nord' }));
    const liste = await waitFor(() => screen.getByRole('menu'));
    expect(
      within(liste)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Bearbeiten', 'Deaktivieren']);
    await userEvent.click(within(liste).getByRole('menuitem', { name: 'Deaktivieren' }));
    expect(m.onWahl).toHaveBeenCalledWith('deaktivieren', S);
  });

  it('`laeuft` sperrt den Auslöser', () => {
    renderMitProviders(<ZeilenMenueAusloeser menue={menue({ laeuft: () => true })} zeile={S} />);
    expect(screen.getByRole('button', { name: 'Aktionen zu Leitstelle Nord' })).toBeDisabled();
  });

  it('`gesperrt` sperrt den Auslöser ohne Ladezustand', () => {
    renderMitProviders(<ZeilenMenueAusloeser menue={menue()} zeile={S} gesperrt />);
    const knopf = screen.getByRole('button', { name: 'Aktionen zu Leitstelle Nord' });
    expect(knopf).toBeDisabled();
    expect(knopf.querySelector('.ant-btn-loading-icon')).toBeNull();
  });

  it('ohne Einträge kein Auslöser', () => {
    renderMitProviders(<ZeilenMenueAusloeser menue={menue({ eintraege: () => [] })} zeile={S} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
