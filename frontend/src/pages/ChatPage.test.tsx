import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
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
  bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null,
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
});
