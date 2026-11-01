import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import KopplungBeendetPage from './KopplungBeendetPage';
import { geraetKontoBestaetigt } from '../offline/fruehereKopplung';
import { queueLeerenFuerTests, schreibaktionEinreihen } from '../offline/queue';

const GERAET_ME = {
  id: 9,
  anzeigename: 'UHS Nord · Tablet 1',
  benutzername: 'geraet-3',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-10-04',
  totp_aktiviert: false,
  passwort_gesetzt: false,
  geraet: {
    kopplung_id: 3,
    einsatz_id: 7,
    ansicht: 'uhs-tablet',
    uhs_id: 2,
    stelle: 'UHS Nord',
    bezeichnung: 'Tablet 1',
    laeuft_ab_at: '2026-10-05 12:00:00',
  },
};

afterEach(() => setzeOnline(true));
beforeEach(async () => {
  await queueLeerenFuerTests();
});

function setup() {
  renderMitProviders(
    <Routes>
      <Route path="/kopplung-beendet" element={<KopplungBeendetPage />} />
      <Route path="/koppeln" element={<p>Koppeln-Seite</p>} />
      <Route path="/geraet" element={<p>Gerätehülle</p>} />
      <Route path="/einsaetze" element={<p>Einsatzliste</p>} />
    </Routes>,
    { route: '/kopplung-beendet' },
  );
}

describe('KopplungBeendetPage (LFH-892)', () => {
  it('sagt „Kopplung beendet“, verweist an die Einsatzleitung und bietet keine Anmeldung', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Kopplung beendet' })).toBeInTheDocument();
    expect(screen.getByText('Neuen Code gibt die Einsatzleitung.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Passwort/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Anmelden/)).not.toBeInTheDocument();
  });

  it('führt zur Eingabe eines neuen Codes', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Neuen Code eingeben' }));
    expect(await screen.findByText('Koppeln-Seite')).toBeInTheDocument();
  });

  it('ohne Netz sagt es „Keine Verbindung“ statt eines Endes', async () => {
    setzeOnline(false);
    setup();
    expect(await screen.findByRole('heading', { name: 'Keine Verbindung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut prüfen' })).toBeInTheDocument();
    expect(screen.queryByText('Neuen Code gibt die Einsatzleitung.')).not.toBeInTheDocument();
  });

  it('kehrt auf die Hülle zurück, wenn die Kopplung beim erneuten Prüfen besteht', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Kopplung beendet' });
    server.use(http.get('/api/auth/me', () => HttpResponse.json(GERAET_ME)));
    await userEvent.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    await waitFor(() => expect(screen.getByText('Gerätehülle')).toBeInTheDocument());
  });

  it('schickt eine angemeldete Person in die Einsatzliste', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ ...GERAET_ME, anzeigename: 'Gerda', geraet: null }),
      ),
    );
    setup();
    expect(await screen.findByText('Einsatzliste')).toBeInTheDocument();
  });
});

describe('KopplungBeendetPage: nicht Übertragenes (LLH-1331)', () => {
  const notiz = (cid: string) =>
    ({
      art: 'notiz',
      person_id: 10,
      bezeichnung: 'R-012',
      daten: { text: 'Infusion läuft', client_id: cid },
    }) as const;

  it('nennt die Anzahl der Einträge der beendeten Kopplung, ohne Inhalt und ohne Verwerfen', async () => {
    await geraetKontoBestaetigt(GERAET_ME.id, { ...GERAET_ME.geraet, stelle_id: 2 });
    for (const cid of ['n-1', 'n-2', 'n-3']) {
      await schreibaktionEinreihen(GERAET_ME.id, 7, notiz(cid));
    }
    setup();
    expect(await screen.findByText('3 Einträge nicht übertragen')).toBeInTheDocument();
    expect(screen.queryByText(/Infusion/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Verwerfen/ })).not.toBeInTheDocument();
  });

  it('zählt keine Einträge einer Person', async () => {
    await schreibaktionEinreihen(55, 7, notiz('p-1'));
    setup();
    await screen.findByRole('heading', { name: 'Kopplung beendet' });
    expect(screen.queryByText(/nicht übertragen/)).not.toBeInTheDocument();
  });
});
