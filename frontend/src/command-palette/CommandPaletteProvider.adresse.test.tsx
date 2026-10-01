// Die Adresszeile über den ECHTEN Provider (LFH-638): echter `useAdressSprung`, echter
// `adressBefehl`, echtes `navigate` des Hosts — nur die Rechteabfrage ist ersetzt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { useLocation } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider } from './CommandPaletteProvider';
import type { Befehl } from './typen';

vi.mock('./useBefehle', () => ({ useBefehle: (): Befehl[] => [] }));
vi.mock('./useDatensaetze', () => ({ useDatensatzTreffer: () => [] }));
vi.mock('./Vorschau', () => ({ Vorschau: () => <div>Vorschau-Inhalt</div> }));
// Lagekarte frei, ohne Netz: die Rechte prüft `useAdressSprung.test.tsx`.
vi.mock('./useLagekarteZugang', () => ({
  useLagekarteZugang: () => ({ frei: true, einsatzFormat: null, orgFormat: null }),
}));

afterEach(() => vi.restoreAllMocks());

function Ort() {
  const l = useLocation();
  return <div data-testid="ort">{l.pathname + l.search}</div>;
}

function app() {
  return renderMitProviders(
    <CommandPaletteProvider>
      <Ort />
    </CommandPaletteProvider>,
    { route: '/einsaetze/5/etb' },
  );
}

const ADRESSE = 'Adresse auf Lagekarte suchen · „Hauptstraße 12“';

describe('CommandPaletteProvider · Adresszeile (LFH-638)', () => {
  it('↵ springt auf die Lagekarte mit ?ort=', async () => {
    const u = userEvent.setup();
    app();
    await u.keyboard('{Control>}k{/Control}');
    await u.type(screen.getByRole('combobox'), 'Hauptstraße 12');
    const zeilen = screen.getAllByRole('option');
    expect(zeilen[zeilen.length - 1]).toHaveTextContent(ADRESSE);
    // Allein steht sie unmarkiert da (nie vorausgewählt) — ↓ wählt sie.
    await u.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('ort')).toHaveTextContent(
      '/einsaetze/5/lagekarte?ort=Hauptstra%C3%9Fe%2012',
    );
  });

  it('Strg+↵ öffnet die Adresssuche im neuen Tab — die Route bleibt stehen', async () => {
    const u = userEvent.setup();
    const oeffne = vi.spyOn(window, 'open').mockReturnValue(null);
    app();
    await u.keyboard('{Control>}k{/Control}');
    await u.type(screen.getByRole('combobox'), 'Hauptstraße 12');
    expect(screen.getByRole('option', { name: new RegExp(ADRESSE) })).toBeInTheDocument();
    await u.keyboard('{ArrowDown}');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', ctrlKey: true });
    expect(oeffne).toHaveBeenCalledTimes(1);
    expect(String(oeffne.mock.calls[0][0])).toBe(
      '/einsaetze/5/lagekarte?ort=Hauptstra%C3%9Fe%2012',
    );
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/5/etb');
  });

  it('eine Koordinate bekommt den Koordinatensprung, keine Adresszeile', async () => {
    const u = userEvent.setup();
    app();
    await u.keyboard('{Control>}k{/Control}');
    await u.type(screen.getByRole('combobox'), '51.16040, 10.45140');
    expect(screen.getByRole('option', { name: /Auf Lagekarte zeigen/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Adresse auf Lagekarte suchen/ })).toBeNull();
  });
});
