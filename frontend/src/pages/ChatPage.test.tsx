import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import ChatPage from './ChatPage';
import type { ChatKanal, ChatNachricht, EinsatzAnzeige } from '../api/types';

const admin = {
  id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-02 10:00:00',
};

const einsatz: EinsatzAnzeige = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-06-02 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-06-02 09:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'Orga',
};

const kanal: ChatKanal = {
  id: 1, einsatz_id: 7, name: 'Allgemein', beschreibung: null,
  erstellt_von_id: 1, erstellt_at: '2026-06-10 09:00:00', archiviert_at: null,
};

const nachricht: ChatNachricht = {
  id: 5, einsatz_id: 7, kanal_id: 1, autor_id: 1, autor_name: 'A',
  inhalt: 'Erste Lage', erstellt_at: '2026-06-10 10:00:00',
  bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null, auftrag_id: null, anhaenge: [],
};

function setup() {
  const nachrichten: ChatNachricht[] = [nachricht];
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
    http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json(nachrichten)),
    http.post('/api/einsaetze/7/chat/kanaele/1/nachrichten', async ({ request }) => {
      const body = (await request.json()) as { inhalt: string };
      const neu: ChatNachricht = { ...nachricht, id: 6, inhalt: body.inhalt };
      nachrichten.push(neu);
      return HttpResponse.json(neu, { status: 201 });
    }),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/chat' },
  );
}

describe('ChatPage', () => {
  it('zeigt Kanal und Nachrichten und erlaubt das Senden', async () => {
    setup();
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    expect(screen.getByText('Allgemein')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Nachricht…'), 'Neue Meldung');
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Neue Meldung')).toBeInTheDocument();
  });

  it('bearbeitet eine eigene Nachricht über das Modal statt window.prompt', async () => {
    let bearbeitet: { inhalt: string } | null = null;
    const nachrichten: ChatNachricht[] = [nachricht];
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json(nachrichten)),
      http.patch('/api/einsaetze/7/chat/nachrichten/5', async ({ request }) => {
        bearbeitet = (await request.json()) as { inhalt: string };
        nachrichten[0] = { ...nachricht, inhalt: bearbeitet.inhalt, bearbeitet_at: '2026-06-10 11:00:00' };
        return HttpResponse.json(nachrichten[0]);
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/chat' },
    );

    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const feld = await screen.findByDisplayValue('Erste Lage');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Lage korrigiert');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(bearbeitet).not.toBeNull());
    expect(bearbeitet!.inhalt).toBe('Lage korrigiert');
    expect(await screen.findByText('Lage korrigiert')).toBeInTheDocument();
  });

  it('lädt einen Anhang hoch und sendet die Nachricht mit anhang_ids', async () => {
    let gesendet: { inhalt: string; anhang_ids: number[] } | null = null;
    const nachrichten: ChatNachricht[] = [nachricht];
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json(nachrichten)),
      http.post('/api/einsaetze/7/anhaenge', () =>
        HttpResponse.json(
          [{ id: 99, einsatz_id: 7, dateiname: 'lage.pdf', mime: 'application/pdf', groesse: 3, hochgeladen_von: 1, erstellt_at: '2026-06-10 10:00:00' }],
          { status: 201 },
        )),
      http.post('/api/einsaetze/7/chat/kanaele/1/nachrichten', async ({ request }) => {
        gesendet = (await request.json()) as { inhalt: string; anhang_ids: number[] };
        const neu: ChatNachricht = { ...nachricht, id: 6, inhalt: gesendet.inhalt };
        nachrichten.push(neu);
        return HttpResponse.json(neu, { status: 201 });
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/chat' },
    );

    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    const datei = new File(['PDF'], 'lage.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, datei);
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));

    await waitFor(() => expect(gesendet).not.toBeNull());
    expect(gesendet!.anhang_ids).toEqual([99]);
  });
});
