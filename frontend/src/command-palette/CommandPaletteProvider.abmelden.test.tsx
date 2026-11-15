/**
 * „Abmelden“ aus der Sprungpalette fragt zurück (LLH-1730, Spec `sprungpalette`, „Abmelden aus
 * der Palette fragt zurück“). Die Palette schließt, die Rückfrage öffnet sich mit dem Fokus auf
 * „Abbrechen“ (design.md D3): ein zweites ↵ beendet die Sitzung nicht.
 */
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { CommandPaletteProvider } from './CommandPaletteProvider';
import { useAuth } from '../auth/AuthContext';

/** Ein anderer Abmeldeweg (wie ein zweiter Tab oder die Sitzungswache): lokal, ohne Rückfrage. */
function AndererWeg() {
  const { abmeldenLokal } = useAuth();
  return (
    <button type="button" onClick={() => abmeldenLokal('sitzungsende')}>
      anderswo abmelden
    </button>
  );
}

function zeige() {
  let abgemeldet = 0;
  server.use(
    meHandler(adminFixture()),
    http.post('/api/auth/logout', () => {
      abgemeldet += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  // Ohne Animation, sonst stünde der Dialog in jsdom nach dem Öffnen nie „fertig“ da.
  renderMitProviders(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <CommandPaletteProvider>
        <Routes>
          <Route path="/login" element={<div>Anmeldeseite</div>} />
          <Route
            path="*"
            element={
              <>
                <div>App-Inhalt</div>
                <AndererWeg />
              </>
            }
          />
        </Routes>
      </CommandPaletteProvider>
    </ConfigProvider>,
  );
  return { abgemeldet: () => abgemeldet };
}

async function waehleAbmeldenInPalette() {
  const u = userEvent.setup();
  await screen.findByText('App-Inhalt');
  await u.keyboard('{Control>}k{/Control}');
  const suche = await screen.findByRole('combobox');
  await u.type(suche, 'Abmelden');
  await screen.findByRole('option', { name: /Abmelden/ });
  await u.keyboard('{Enter}');
  return u;
}

describe('Sprungpalette — Abmelden', () => {
  it('↵ auf „Abmelden“ schließt die Palette und öffnet die Rückfrage, ohne abzumelden', async () => {
    const zaehler = zeige();
    const u = await waehleAbmeldenInPalette();
    const dialog = await screen.findByRole('dialog', { name: 'Abmelden?' });
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    const abbrechen = within(dialog).getByRole('button', { name: 'Abbrechen' });
    await waitFor(() => expect(abbrechen).toHaveFocus());
    // Ein zweites ↵ trifft „Abbrechen“, nicht „Abmelden“.
    await u.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Abmelden?' })).toBeNull());
    expect(zaehler.abgemeldet()).toBe(0);
    expect(screen.getByText('App-Inhalt')).toBeInTheDocument();
  });

  it('die Bestätigung meldet ab und führt zur Anmeldung', async () => {
    const zaehler = zeige();
    const u = await waehleAbmeldenInPalette();
    const dialog = await screen.findByRole('dialog', { name: 'Abmelden?' });
    await u.click(within(dialog).getByRole('button', { name: 'Abmelden' }));
    expect(await screen.findByText('Anmeldeseite')).toBeInTheDocument();
    expect(zaehler.abgemeldet()).toBe(1);
  });

  it('endet die Sitzung auf anderem Weg, verschwindet die Rückfrage (Review)', async () => {
    const zaehler = zeige();
    await waehleAbmeldenInPalette();
    await screen.findByRole('dialog', { name: 'Abmelden?' });
    // Die Maske deckt den Knopf ab; der andere Weg kommt hier stellvertretend für Tab oder 401.
    fireEvent.click(screen.getByRole('button', { name: 'anderswo abmelden' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Abmelden?' })).toBeNull());
    expect(zaehler.abgemeldet()).toBe(0);
  });
});
