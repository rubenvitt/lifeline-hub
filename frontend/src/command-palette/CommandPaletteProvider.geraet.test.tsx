import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { benutzerFixture } from '../test/fixtures';
import { useAuth } from '../auth/AuthContext';
import { CommandPaletteProvider } from './CommandPaletteProvider';

/**
 * Ein gekoppeltes Gerät hat keine Sprungpalette (LFH-892, Spec `feldgeraet-bedienung`, „Keine
 * Sprungpalette“) und fragt das Palettengedächtnis nicht ab.
 */

const GERAET = {
  kopplung_id: 3,
  einsatz_id: 7,
  ansicht: 'uhs-tablet' as const,
  uhs_id: 2,
  stelle: 'UHS Nord',
  bezeichnung: 'Tablet 1',
  laeuft_ab_at: '2026-10-05 12:00:00',
};

function Bereit() {
  const { benutzer } = useAuth();
  return benutzer ? <p>bereit</p> : null;
}

function rendern() {
  return renderMitProviders(
    <CommandPaletteProvider>
      <Bereit />
    </CommandPaletteProvider>,
  );
}

describe('Sprungpalette am Gerät (LFH-892)', () => {
  it('öffnet sich am Tablet nicht und liest kein Gedächtnis', async () => {
    const gelesen = vi.fn();
    server.use(
      meHandler({ ...benutzerFixture({ anzeigename: 'UHS Nord · Tablet 1' }), geraet: GERAET }),
      http.get('/api/benutzer-einstellungen', () => {
        gelesen();
        return HttpResponse.json({ eintraege: {} });
      }),
    );
    const u = userEvent.setup();
    rendern();
    await screen.findByText('bereit');
    await u.keyboard('{Control>}k{/Control}');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(gelesen).not.toHaveBeenCalled();
  });

  it('öffnet sich für eine Person wie gewohnt (Gegenprobe)', async () => {
    server.use(
      meHandler(benutzerFixture({ anzeigename: 'EL' })),
      http.get('/api/benutzer-einstellungen', () => HttpResponse.json({ eintraege: {} })),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
    );
    const u = userEvent.setup();
    rendern();
    await screen.findByText('bereit');
    await u.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeNull());
  });
});
