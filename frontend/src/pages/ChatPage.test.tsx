import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Link, Route, Routes } from 'react-router';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import ChatPage from './ChatPage';
import type { ChatKanal, ChatNachricht, EinsatzAnzeige } from '../api/types';

afterEach(() => vi.restoreAllMocks());

// Normaler Benutzer (kein System-Admin): die Rollen-Tests prüfen die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = {
  id: 1,
  anzeigename: 'A',
  benutzername: 'a',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-06-02 10:00:00',
};

const einsatz: EinsatzAnzeige = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  stichwort: null,
  status: 'aktiv',
  begonnen_at: '2026-06-02 09:00:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  einsatzart: 'realeinsatz',
  einsatznummer_intern: null,
  angelegt_at: '2026-06-02 09:00:00',
  leitstellen_nr: null,
  einsatzort: null,
  einsatzort_lat: null,
  einsatzort_lon: null,
  meldende_stelle: null,
  sachverhalt: null,
  anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
  org_id: 1,
  org_name: 'Orga',
  meine_sachgebiete: [],
};

const kanal: ChatKanal = {
  id: 1,
  einsatz_id: 7,
  name: 'Allgemein',
  beschreibung: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-10 09:00:00',
  archiviert_at: null,
  letzte_nachricht_at: '2026-06-10 10:00:00',
  ungelesen_anzahl: 0,
};

const nachricht: ChatNachricht = {
  id: 5,
  einsatz_id: 7,
  kanal_id: 1,
  autor_id: 1,
  autor_name: 'A',
  inhalt: 'Erste Lage',
  erstellt_at: '2026-06-10 10:00:00',
  bearbeitet_at: null,
  geloescht_at: null,
  etb_eintrag_id: null,
  auftrag_id: null,
  bezug_typ: null,
  bezug_id: null,
  anhaenge: [],
};

function setup(ungelesen = 0, onGelesen?: () => void) {
  const nachrichten: ChatNachricht[] = [nachricht];
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/chat/kanaele', () =>
      HttpResponse.json([
        {
          ...kanal,
          ungelesen_anzahl: ungelesen,
        },
      ]),
    ),
    http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json(nachrichten)),
    http.post('/api/einsaetze/7/chat/kanaele/1/gelesen', () => {
      onGelesen?.();
      return new HttpResponse(null, { status: 204 });
    }),
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

  it('markiert den erfolgreich geöffneten Kanal persistent gelesen', async () => {
    let markiert = 0;
    setup(1, () => {
      markiert += 1;
    });
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await waitFor(() => expect(markiert).toBeGreaterThan(0));
  });

  it('markiert neue Nachrichten im Hintergrund erst beim Zurückkehren gelesen', async () => {
    const sichtbarkeit = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    let markiert = 0;
    setup(1, () => {
      markiert += 1;
    });

    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    expect(markiert).toBe(0);

    sichtbarkeit.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(markiert).toBeGreaterThan(0));
  });

  it('lädt ältere Nachrichten über den "Ältere laden"-Button nach (before_id)', async () => {
    // Erste Seite: volle Seitengröße (100) → es gibt mehr → Button erscheint.
    const ersteSeite: ChatNachricht[] = Array.from({ length: 100 }, (_, i) => ({
      ...nachricht,
      id: 200 - i,
      inhalt: `Aktuell ${200 - i}`,
    }));
    let zweiteSeiteAngefragtMit: string | null = null;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', ({ request }) => {
        const beforeId = new URL(request.url).searchParams.get('before_id');
        if (beforeId) {
          zweiteSeiteAngefragtMit = beforeId;
          return HttpResponse.json([{ ...nachricht, id: 5, inhalt: 'Uralte Nachricht' }]);
        }
        return HttpResponse.json(ersteSeite);
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

    expect(await screen.findByText('Aktuell 200')).toBeInTheDocument();
    const button = await screen.findByRole('button', { name: 'Ältere laden' });
    await userEvent.click(button);

    expect(await screen.findByText('Uralte Nachricht')).toBeInTheDocument();
    // Cursor = älteste (kleinste) id der ersten Seite = 101.
    expect(zweiteSeiteAngefragtMit).toBe('101');
  });

  it('zeigt keinen „Ältere laden"-Button bei einer kurzen Seite', async () => {
    setup();
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).not.toBeInTheDocument();
  });

  it('lädt die Bezug-Listen nicht eager, wenn keine Nachricht einen Bezug trägt', async () => {
    const listenAufgerufen: string[] = [];
    const spy = (pfad: string) =>
      http.get(`/api/einsaetze/7/${pfad}`, () => {
        listenAufgerufen.push(pfad);
        return HttpResponse.json([]);
      });
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json([nachricht])),
      spy('schaeden'),
      spy('uhs'),
      spy('personen'),
      spy('lageberichte'),
      spy('meldungen'),
      spy('auftraege'),
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
    await new Promise((r) => setTimeout(r, 50));
    expect(listenAufgerufen).toEqual([]);
  });

  it('setzt einen Sachbezug end-to-end über den Dialog (LFH-103)', async () => {
    let gesetzt: { typ: string; ziel_id: number } | null = null;
    const nachrichten: ChatNachricht[] = [nachricht];
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json(nachrichten)),
      http.get('/api/einsaetze/7/schaeden', () =>
        HttpResponse.json([{ id: 3, registrier_nr: 3, typ: 'sachschaden', ort: 'B5 km12' }]),
      ),
      http.get('/api/einsaetze/7/uhs', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/personen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/lageberichte', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/meldungen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/auftraege', () => HttpResponse.json([])),
      http.put('/api/einsaetze/7/chat/nachrichten/5/bezug', async ({ request }) => {
        gesetzt = (await request.json()) as { typ: string; ziel_id: number };
        nachrichten[0] = { ...nachricht, bezug_typ: 'schaden', bezug_id: gesetzt.ziel_id };
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
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bezug' }));
    const comboboxen = screen.getAllByRole('combobox');
    await userEvent.click(comboboxen[0]);
    await userEvent.click(await screen.findByText('Schaden'));
    await userEvent.click(comboboxen[1]);
    await userEvent.click(await screen.findByText('S-003 · sachschaden · B5 km12'));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(gesetzt).not.toBeNull());
    expect(gesetzt).toEqual({ typ: 'schaden', ziel_id: 3 });
  });

  it('bearbeitet eine eigene Nachricht über das Modal statt window.prompt', async () => {
    let bearbeitet: { inhalt: string } | null = null;
    const nachrichten: ChatNachricht[] = [nachricht];
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json(nachrichten)),
      http.patch('/api/einsaetze/7/chat/nachrichten/5', async ({ request }) => {
        bearbeitet = (await request.json()) as { inhalt: string };
        nachrichten[0] = {
          ...nachricht,
          inhalt: bearbeitet.inhalt,
          bearbeitet_at: '2026-06-10 11:00:00',
        };
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
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bearbeiten' }));
    const feld = await screen.findByDisplayValue('Erste Lage');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Lage korrigiert');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(bearbeitet).not.toBeNull());
    expect(bearbeitet!.inhalt).toBe('Lage korrigiert');
    // jsdom 29 spiegelt den getippten Textarea-Wert in den textContent; die noch
    // mountete Edit-Textarea würde sonst zusätzlich matchen. Wir prüfen den gerenderten
    // Nachrichtentext, nicht den Formularwert → Formularfelder ignorieren.
    expect(
      await screen.findByText('Lage korrigiert', { ignore: 'script, style, textarea' }),
    ).toBeInTheDocument();
  });

  it('zeigt bei abgeschlossenem Einsatz einen Read-only-Hinweis statt der Eingabe', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz, status: 'abgeschlossen' }),
      ),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json([nachricht])),
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
    expect(screen.getByText(/nur bei aktivem Einsatz/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nachricht…')).not.toBeInTheDocument();
  });

  it('zeigt ohne Führungsrolle einen Read-only-Hinweis (Einsatz aktiv)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz, meine_rolle: 'beobachter' }),
      ),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json([nachricht])),
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
    expect(
      screen.getByText(/Einsatzleitung und dem Führungspersonal vorbehalten/i),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nachricht…')).not.toBeInTheDocument();
  });

  it('lädt einen Anhang hoch und sendet die Nachricht mit anhang_ids', async () => {
    let gesendet: { inhalt: string; anhang_ids: number[] } | null = null;
    const nachrichten: ChatNachricht[] = [nachricht];
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json(nachrichten)),
      http.post('/api/einsaetze/7/anhaenge', () =>
        HttpResponse.json(
          [
            {
              id: 99,
              einsatz_id: 7,
              dateiname: 'lage.pdf',
              mime: 'application/pdf',
              groesse: 3,
              hochgeladen_von: 1,
              erstellt_at: '2026-06-10 10:00:00',
            },
          ],
          { status: 201 },
        ),
      ),
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

  it('verwendet nach einem Einsatzwechsel ausschließlich einen Kanal des neuen Einsatzes', async () => {
    const nachrichtenRequests: string[] = [];
    const gesendetAn: string[] = [];
    const kanaeleA: ChatKanal[] = [kanal, { ...kanal, id: 2, name: 'A Spezial' }];
    const kanalB: ChatKanal = {
      ...kanal,
      id: 9,
      einsatz_id: 8,
      name: 'B Allgemein',
    };
    const nachrichtenNachKanal = new Map<string, ChatNachricht[]>([
      ['7/1', [{ ...nachricht, inhalt: 'A Allgemein Lage' }]],
      ['7/2', [{ ...nachricht, id: 6, kanal_id: 2, inhalt: 'A Spezial Lage' }]],
      ['8/9', [{ ...nachricht, id: 7, einsatz_id: 8, kanal_id: 9, inhalt: 'B Lage' }]],
    ]);

    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/:einsatzId', ({ params }) => {
        const zielId = Number(params.einsatzId);
        return HttpResponse.json({ ...einsatz, id: zielId, bezeichnung: `Einsatz ${zielId}` });
      }),
      http.get('/api/einsaetze/:einsatzId/chat/kanaele', ({ params }) =>
        HttpResponse.json(params.einsatzId === '8' ? [kanalB] : kanaeleA),
      ),
      http.get('/api/einsaetze/:einsatzId/chat/kanaele/:kanalId/nachrichten', ({ params }) => {
        const ziel = `${params.einsatzId}/${params.kanalId}`;
        nachrichtenRequests.push(ziel);
        return HttpResponse.json(nachrichtenNachKanal.get(ziel) ?? []);
      }),
      http.post(
        '/api/einsaetze/:einsatzId/chat/kanaele/:kanalId/nachrichten',
        async ({ params, request }) => {
          const ziel = `${params.einsatzId}/${params.kanalId}`;
          gesendetAn.push(ziel);
          const body = (await request.json()) as { inhalt: string };
          const neu: ChatNachricht = {
            ...nachricht,
            id: 8,
            einsatz_id: Number(params.einsatzId),
            kanal_id: Number(params.kanalId),
            inhalt: body.inhalt,
          };
          nachrichtenNachKanal.set(ziel, [...(nachrichtenNachKanal.get(ziel) ?? []), neu]);
          return HttpResponse.json(neu, { status: 201 });
        },
      ),
    );

    renderMitProviders(
      <AuthProvider>
        <Link to="/einsaetze/8/chat">Zu Einsatz B</Link>
        <Routes>
          <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/chat' },
    );

    expect(await screen.findByText('A Allgemein Lage')).toBeInTheDocument();
    await userEvent.click(screen.getByText('A Spezial'));
    expect(await screen.findByText('A Spezial Lage')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Zu Einsatz B' }));
    expect(await screen.findByText('B Lage')).toBeInTheDocument();
    expect(nachrichtenRequests).not.toContain('8/2');

    await userEvent.type(screen.getByPlaceholderText('Nachricht…'), 'Nach B');
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(gesendetAn).toEqual(['8/9']));
    expect(await screen.findByText('Nach B')).toBeInTheDocument();
  });
});
