/**
 * Rückfrage vor dem Abmelden (LLH-1730, Spec `benutzermenue`, „Abmelden fragt zurück“; design.md
 * D2/D3 der Change `drftcjks-benutzermenue-abmelden-anzeige`). Die Sitzung endet erst mit der
 * Bestätigung; der Fokus steht zuerst auf „Abbrechen“, damit ein zweites ↵ nicht doch abmeldet.
 */
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { useAbmeldenRueckfrage } from './AbmeldenRueckfrage';

function Ausloeser() {
  const { open, dialog } = useAbmeldenRueckfrage();
  return (
    <>
      <button type="button" onClick={open}>
        auslösen
      </button>
      {dialog}
    </>
  );
}

function zeige(logoutStatus: number) {
  let abgemeldet = 0;
  server.use(
    meHandler(adminFixture()),
    http.post('/api/auth/logout', () => {
      abgemeldet += 1;
      return logoutStatus === 204
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json({ error: 'fremd' }, { status: logoutStatus });
    }),
  );
  // Ohne Animation: sonst bliebe der geschlossene Dialog in jsdom im Ausblenden stehen, und
  // „geschlossen“ wäre nicht prüfbar.
  renderMitProviders(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Routes>
        <Route path="/login" element={<div>Anmeldeseite</div>} />
        <Route path="*" element={<Ausloeser />} />
      </Routes>
    </ConfigProvider>,
  );
  return { abgemeldet: () => abgemeldet };
}

async function oeffne() {
  await userEvent.click(await screen.findByRole('button', { name: 'auslösen' }));
  return screen.findByRole('dialog', { name: 'Abmelden?' });
}

describe('Rückfrage vor dem Abmelden', () => {
  it('öffnet „Abmelden?“ mit „Abbrechen“ im Fokus und rotem „Abmelden“, ohne abzumelden', async () => {
    const zaehler = zeige(204);
    const dialog = await oeffne();
    expect(dialog).toHaveTextContent('Die Sitzung auf diesem Gerät endet.');
    const abbrechen = screen.getByRole('button', { name: 'Abbrechen' });
    await waitFor(() => expect(abbrechen).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Abmelden' })).toHaveClass('ant-btn-dangerous');
    expect(zaehler.abgemeldet()).toBe(0);
  });

  it('Bestätigen meldet ab und führt zur Anmeldung', async () => {
    const zaehler = zeige(204);
    await oeffne();
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(await screen.findByText('Anmeldeseite')).toBeInTheDocument();
    expect(zaehler.abgemeldet()).toBe(1);
  });

  it('„Abbrechen“ schließt, ohne abzumelden', async () => {
    const zaehler = zeige(204);
    await oeffne();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Abmelden?' })).toBeNull());
    expect(screen.queryByText('Anmeldeseite')).not.toBeInTheDocument();
    expect(zaehler.abgemeldet()).toBe(0);
  });

  it('Escape schließt, ohne abzumelden', async () => {
    const zaehler = zeige(204);
    await oeffne();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Abmelden?' })).toBeNull());
    expect(zaehler.abgemeldet()).toBe(0);
  });

  it('während die Abmeldung läuft, lässt sich die Rückfrage nicht mehr schließen (Review)', async () => {
    let freigeben: () => void = () => {};
    server.use(
      meHandler(adminFixture()),
      http.post(
        '/api/auth/logout',
        () =>
          new Promise<Response>((resolve) => {
            freigeben = () => resolve(new HttpResponse(null, { status: 204 }));
          }),
      ),
    );
    renderMitProviders(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <Routes>
          <Route path="/login" element={<div>Anmeldeseite</div>} />
          <Route path="*" element={<Ausloeser />} />
        </Routes>
      </ConfigProvider>,
    );
    const dialog = await oeffne();
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    // Der Aufruf hängt: „Abbrechen“ ist gesperrt, Escape und Schließknopf wirken nicht.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /close|schließen/i })).toBeNull();
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Abmelden?' })).toBeInTheDocument();
    freigeben();
    expect(await screen.findByText('Anmeldeseite')).toBeInTheDocument();
  });

  it('bleibt stehen, wenn der Server das Abmelden mit 412 ablehnt (LFH-387)', async () => {
    const zaehler = zeige(412);
    await oeffne();
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    await waitFor(() => expect(zaehler.abgemeldet()).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('Anmeldeseite')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auslösen' })).toBeInTheDocument();
  });
});
