import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import KoppelnPage from './KoppelnPage';
import { warGeraet } from './geraetMarke';

const PERSON = {
  id: 4,
  anzeigename: 'Gerda Maier',
  benutzername: 'gerda',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-09-30',
  totp_aktiviert: false,
  passwort_gesetzt: true,
};

const GERAET = {
  kopplung_id: 3,
  einsatz_id: 7,
  ansicht: 'uhs-tablet',
  uhs_id: 2,
  stelle: 'UHS Nord',
  bezeichnung: 'Tablet 1',
  laeuft_ab_at: '2026-10-05 12:00:00',
};

afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

function setup(adresse = '/koppeln') {
  window.history.replaceState(null, '', adresse);
  const navigiere = vi.fn();
  renderMitProviders(<KoppelnPage navigiere={navigiere} />, { route: '/koppeln' });
  return navigiere;
}

describe('KoppelnPage (LFH-892)', () => {
  it('übernimmt den Code aus dem Fragment und nimmt ihn aus der Adresse', async () => {
    setup('/koppeln#ABCD1234');
    expect(await screen.findByLabelText('Kopplungscode')).toHaveValue('ABCD1234');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/koppeln');
  });

  it('löst den Code ein, merkt sich das Gerät und lädt die Hülle', async () => {
    const gesendet = vi.fn();
    server.use(
      http.post('/api/geraete/koppeln', async ({ request }) => {
        gesendet(await request.json());
        return HttpResponse.json(GERAET);
      }),
    );
    const navigiere = setup();
    await userEvent.type(await screen.findByLabelText('Kopplungscode'), ' abcd-1234 ');
    await userEvent.click(screen.getByRole('button', { name: 'Gerät koppeln' }));
    await waitFor(() => expect(navigiere).toHaveBeenCalledWith('/geraet'));
    // Normalisieren ist Sache des Servers; die Seite schneidet nur die Ränder ab.
    expect(gesendet).toHaveBeenCalledWith({ code: 'abcd-1234' });
    expect(warGeraet()).toBe(true);
  });

  it('sagt bei 401 nur, dass der Code nicht gilt, und bleibt auf der Seite', async () => {
    server.use(
      http.post(
        '/api/geraete/koppeln',
        () => new HttpResponse(JSON.stringify({ error: 'Nicht angemeldet' }), { status: 401 }),
      ),
    );
    const navigiere = setup('/koppeln#FALSCH12');
    await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
    expect(
      await screen.findByText(
        'Dieser Code gilt nicht (mehr). Lass dir bei der Einsatzleitung einen neuen geben.',
      ),
    ).toBeInTheDocument();
    expect(navigiere).not.toHaveBeenCalled();
    expect(warGeraet()).toBe(false);
  });

  it('verlangt einen Code, bevor es etwas schickt', async () => {
    const gesendet = vi.fn();
    server.use(
      http.post('/api/geraete/koppeln', () => {
        gesendet();
        return HttpResponse.json(GERAET);
      }),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
    expect(await screen.findByText('Code eingeben')).toBeInTheDocument();
    expect(gesendet).not.toHaveBeenCalled();
  });

  it('koppelt nicht, solange eine Person angemeldet ist', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(PERSON)));
    setup('/koppeln#ABCD1234');
    expect(
      await screen.findByText(/In diesem Browser ist Gerda Maier angemeldet/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerät koppeln' })).not.toBeInTheDocument();
  });

  it('erlaubt einem gekoppelten Gerät einen neuen Code und sagt, dass er ersetzt', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ ...PERSON, anzeigename: 'UHS Nord · Tablet 1', geraet: GERAET }),
      ),
    );
    setup();
    expect(
      await screen.findByText(
        'Dieses Gerät ist schon als Tablet 1 gekoppelt. Ein neuer Code ersetzt die Kopplung.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerät koppeln' })).toBeInTheDocument();
  });
});
