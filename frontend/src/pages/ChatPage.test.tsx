import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Link, Route, Routes } from 'react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import ChatPage from './ChatPage';
import type { ChatKanal, ChatNachricht } from '../api/types';
import { benutzerFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';
import { setzeViewportBreite } from '../test/viewport';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';

afterEach(() => vi.restoreAllMocks());

// Normaler Benutzer (kein System-Admin): die Rollen-Tests prüfen die Einsatz-Rolle; admin-global
// deckt schreibrecht.test.ts ab.
const nutzer = benutzerFixture({ anzeigename: 'A' });

const einsatz = einsatzFixture({ id: 7, bezeichnung: 'Hochwasser Nord' });

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
    meHandler(nutzer),
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
    <Routes>
      <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
    </Routes>,
    { route: '/einsaetze/7/chat' },
  );
}

describe('ChatPage', () => {
  it('zählt einen einzelnen Kanal im Kopf in der Einzahl', async () => {
    setup();
    expect(await screen.findByText('1 Kanal')).toBeInTheDocument();
  });

  it('zeigt Kanal und Nachrichten und erlaubt das Senden', async () => {
    setup();
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    expect(screen.getByText('Allgemein')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Nachricht…'), 'Neue Meldung');
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Neue Meldung')).toBeInTheDocument();
  });

  it('behält die Nachricht im Feld, wenn der Server das Senden ablehnt (LFH-795)', async () => {
    setup();
    server.use(
      http.post('/api/einsaetze/7/chat/kanaele/1/nachrichten', () =>
        HttpResponse.json({ error: 'Zu groß' }, { status: 413 }),
      ),
    );
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    const feld = screen.getByPlaceholderText('Nachricht…');
    await userEvent.type(feld, 'Geht verloren?');
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Senden' })).not.toHaveClass('ant-btn-loading'),
    );
    expect(feld).toHaveValue('Geht verloren?');
    // Der Fehler steht an der Eingabe, nicht im Toast, und geht beim nächsten Absenden.
    const alarm = await screen.findByRole('alert');
    expect(alarm).toHaveTextContent('Nicht gesendet');
    expect(alarm).toHaveTextContent('Zu groß');
    expect(document.querySelector('.ant-message')).toBeNull();
    server.use(
      http.post('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => new Promise(() => undefined)),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('behält Name und Beschreibung, wenn der Server die Kanalanlage ablehnt (LFH-795)', async () => {
    const user = userEvent.setup();
    let versucht = 0;
    setup();
    server.use(
      http.post('/api/einsaetze/7/chat/kanaele', () => {
        versucht += 1;
        return HttpResponse.json({ error: 'Name vergeben' }, { status: 409 });
      }),
    );
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kanal anlegen' }));
    await user.type(await screen.findByLabelText('Name'), 'Allgemein');
    await user.type(screen.getByLabelText('Beschreibung (optional)'), 'Zweiter Versuch');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(versucht).toBe(1));
    // Die Ablehnung ist verarbeitet, sobald die Fehlermeldung steht.
    expect(await screen.findByText('Name vergeben')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveClass('ant-zoom-leave');
    expect(screen.getByLabelText('Name')).toHaveValue('Allgemein');
    expect(screen.getByLabelText('Beschreibung (optional)')).toHaveValue('Zweiter Versuch');
  });

  it('markiert den erfolgreich geöffneten Kanal persistent gelesen', async () => {
    let markiert = 0;
    setup(1, () => {
      markiert += 1;
    });
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await waitFor(() => expect(markiert).toBeGreaterThan(0));
  });

  // Das Lesen erzeugt kein Live-Ereignis; ohne eigene Invalidierung stünde der Chat-Zähler bis zum
  // nächsten fremden Ereignis auf dem alten Wert.
  it('zieht nach dem Lesen den Modulzähler nach', async () => {
    const { client } = setup(1);
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    await waitFor(() =>
      expect(invalidiert).toHaveBeenCalledWith({ queryKey: ['einsatz-modul-zaehler', 7] }),
    );
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
      meHandler(nutzer),
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
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>,
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
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json([nachricht])),
      spy('schaeden/auswahl'),
      spy('uhs'),
      spy('personen/auswahl'),
      spy('lageberichte'),
      spy('meldungen'),
      spy('auftraege'),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>,
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
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json(nachrichten)),
      http.get('/api/einsaetze/7/schaeden/auswahl', () =>
        HttpResponse.json([{ id: 3, registrier_nr: 3, typ: 'sachschaden', ort: 'B5 km12' }]),
      ),
      http.get('/api/einsaetze/7/uhs', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/personen/auswahl', () => HttpResponse.json([])),
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
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>,
      { route: '/einsaetze/7/chat' },
    );

    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Aktionen zu Nachricht von / }));
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
      meHandler(nutzer),
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
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>,
      { route: '/einsaetze/7/chat' },
    );

    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Aktionen zu Nachricht von / }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bearbeiten' }));
    const feld = await screen.findByDisplayValue('Erste Lage');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Lage korrigiert');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(bearbeitet).not.toBeNull());
    expect(bearbeitet!.inhalt).toBe('Lage korrigiert');
    // jsdom spiegelt den getippten Textarea-Wert in den textContent; die noch montierte
    // Edit-Textarea würde sonst mitmatchen. Geprüft wird der gerenderte Nachrichtentext.
    expect(
      await screen.findByText('Lage korrigiert', { ignore: 'script, style, textarea' }),
    ).toBeInTheDocument();
  });

  // LFH-700: Die im Dialog gewählten Anhänge gehen als `anhang_ids` an den Server.
  it('stuft eine Nachricht samt gewähltem Anhang ins ETB herauf', async () => {
    let gesendet: unknown = null;
    const mitFoto: ChatNachricht = {
      ...nachricht,
      anhaenge: [
        {
          id: 31,
          einsatz_id: 7,
          dateiname: 'deich.jpg',
          mime: 'image/jpeg',
          groesse: 2048,
          hochgeladen_von: 1,
          erstellt_at: '2026-06-10 10:00:00',
        },
      ],
    };
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json([mitFoto])),
      http.post('/api/einsaetze/7/chat/nachrichten/5/heraufstufen-etb', async ({ request }) => {
        gesendet = await request.json();
        return HttpResponse.json({ ...mitFoto, etb_eintrag_id: 40 });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>,
      { route: '/einsaetze/7/chat' },
    );

    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Aktionen zu Nachricht von / }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zu ETB' }));
    expect(await screen.findByRole('checkbox', { name: /deich\.jpg/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Heraufstufen' }));

    await waitFor(() =>
      expect(gesendet).toEqual({ typ: 'meldung', inhalt: 'Erste Lage', anhang_ids: [31] }),
    );
  });

  it('sperrt „Zu ETB" nach den Freigaben des Servers (LFH-904)', async () => {
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ etb: { zugriff: false } })),
      ),
    );
    setup();
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Aktionen zu Nachricht von / }));
    expect(
      await screen.findByRole('menuitem', { name: 'Zu ETB (Keine Berechtigung)' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Zu Auftrag' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('sperrt „Zu Auftrag" nach den Freigaben des Servers (LFH-904)', async () => {
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ auftraege: { zugriff: false } })),
      ),
    );
    setup();
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Aktionen zu Nachricht von / }));
    expect(
      await screen.findByRole('menuitem', { name: 'Zu Auftrag (Keine Berechtigung)' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Zu ETB' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('zeigt bei abgeschlossenem Einsatz einen Read-only-Hinweis statt der Eingabe', async () => {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz, status: 'abgeschlossen' }),
      ),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json([nachricht])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>,
      { route: '/einsaetze/7/chat' },
    );
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    expect(screen.getByText(/nur bei aktivem Einsatz/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nachricht…')).not.toBeInTheDocument();
  });

  it('zeigt ohne Führungsrolle einen Read-only-Hinweis (Einsatz aktiv)', async () => {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz, meine_rolle: 'beobachter' }),
      ),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json([nachricht])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>,
      { route: '/einsaetze/7/chat' },
    );
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    expect(
      screen.getByText(/Einsatzleitung und dem Führungspersonal vorbehalten/i),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nachricht…')).not.toBeInTheDocument();
  });

  /** Chat mit einem Kanal, Senden ins Leere protokolliert; der Anhang geht über die XHR-Attrappe. */
  function anhangSetup() {
    const anfragen = installiereXhrAttrappe();
    let gesendet: { inhalt: string; anhang_ids: number[] } | null = null;
    const nachrichten: ChatNachricht[] = [nachricht];
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
      http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json(nachrichten)),
      http.post('/api/einsaetze/7/chat/kanaele/1/nachrichten', async ({ request }) => {
        gesendet = (await request.json()) as { inhalt: string; anhang_ids: number[] };
        const neu: ChatNachricht = { ...nachricht, id: 6, inhalt: gesendet.inhalt };
        nachrichten.push(neu);
        return HttpResponse.json(neu, { status: 201 });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>,
      { route: '/einsaetze/7/chat' },
    );
    return { anfragen, gesendet: () => gesendet };
  }

  async function sendeMitAnhang(text = 'Foto vom Dach') {
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Nachricht…'), text);
    const datei = new File(['PDF'], 'lage.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, datei);
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
  }

  describe('Anhänge (LFH-1021)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('lädt einen Anhang hoch und sendet die Nachricht mit anhang_ids', async () => {
      const { anfragen, gesendet } = anhangSetup();
      await sendeMitAnhang();
      await waitFor(() => expect(anfragen).toHaveLength(1));
      expect(anfragen[0].url).toBe('/api/einsaetze/7/anhaenge');
      expect(anfragen[0].timeout).toBe(120_000);
      act(() =>
        anfragen[0].antworten(201, [
          {
            id: 99,
            einsatz_id: 7,
            dateiname: 'lage.pdf',
            mime: 'application/pdf',
            groesse: 3,
            hochgeladen_von: 1,
            erstellt_at: '2026-06-10 10:00:00',
          },
        ]),
      );

      await waitFor(() => expect(gesendet()).not.toBeNull());
      expect(gesendet()!.anhang_ids).toEqual([99]);
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    });

    it('zeigt Prozent während der Übertragung, danach „Datei wird geprüft“', async () => {
      const { anfragen } = anhangSetup();
      await sendeMitAnhang();
      await waitFor(() => expect(anfragen).toHaveLength(1));
      act(() => anfragen[0].fortschritt(1, 4));
      expect(
        await screen.findByRole('progressbar', { name: 'Wird hochgeladen · 25 %' }),
      ).toBeInTheDocument();
      act(() => anfragen[0].uebertragen());
      expect(
        await screen.findByRole('progressbar', { name: 'Datei wird geprüft' }),
      ).toBeInTheDocument();
    });

    it('Zeitlimit nach dem letzten Byte: „unklar“, nicht „nicht abgeschickt“; Text bleibt', async () => {
      const { anfragen, gesendet } = anhangSetup();
      await sendeMitAnhang('Foto vom Dach');
      await waitFor(() => expect(anfragen).toHaveLength(1));
      act(() => {
        anfragen[0].uebertragen();
        anfragen[0].zeitlimit();
      });

      const alarm = await screen.findByRole('alert');
      expect(alarm).toHaveTextContent('Senden unklar');
      expect(alarm).toHaveTextContent(/unklar/);
      expect(alarm).not.toHaveTextContent(/NICHT abgeschickt/);
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('Nachricht…')).toHaveValue('Foto vom Dach');
      expect(gesendet()).toBeNull();
    });

    it('Abbruch vor dem letzten Byte: „Nicht gesendet“, nicht abgeschickt', async () => {
      const { anfragen } = anhangSetup();
      await sendeMitAnhang();
      await waitFor(() => expect(anfragen).toHaveLength(1));
      act(() => {
        anfragen[0].fortschritt(1, 2);
        anfragen[0].netzfehler();
      });
      const alarm = await screen.findByRole('alert');
      expect(alarm).toHaveTextContent('Nicht gesendet');
      expect(alarm).toHaveTextContent('NICHT abgeschickt');
    });
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
      meHandler(nutzer),
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
      <>
        <Link to="/einsaetze/8/chat">Zu Einsatz B</Link>
        <Routes>
          <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
        </Routes>
      </>,
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

/**
 * LFH-976: Unter `md` ersetzt die Kanal-Leiste die `KanalListe` — und damit deren Kopfaktion.
 * Der Knopf daneben öffnet denselben Dialog; ohne Schreibrecht fehlt er wie ab `md`.
 */
describe('ChatPage — Kanal anlegen unter md (LFH-976)', () => {
  function setupSchmal(meineRolle: 'einsatzleitung' | 'beobachter' = 'einsatzleitung') {
    const kanaele: ChatKanal[] = [kanal];
    const angelegt: { name: string; beschreibung?: string }[] = [];
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz, meine_rolle: meineRolle }),
      ),
      http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json(kanaele)),
      http.get('/api/einsaetze/7/chat/kanaele/:kanalId/nachrichten', ({ params }) =>
        HttpResponse.json(params.kanalId === '1' ? [nachricht] : []),
      ),
      http.post('/api/einsaetze/7/chat/kanaele', async ({ request }) => {
        const body = (await request.json()) as { name: string; beschreibung?: string };
        angelegt.push(body);
        const neu: ChatKanal = {
          ...kanal,
          id: 2,
          name: body.name,
          beschreibung: body.beschreibung ?? null,
          letzte_nachricht_at: null,
        };
        kanaele.push(neu);
        return HttpResponse.json(neu, { status: 201 });
      }),
    );
    setzeViewportBreite(390);
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>,
      { route: '/einsaetze/7/chat' },
    );
    return { angelegt };
  }

  it('bietet neben der Kanal-Leiste „Kanal anlegen" an, außerhalb der Tabliste', async () => {
    setupSchmal();
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    expect(screen.queryByTestId('kanal-spalte')).not.toBeInTheDocument();

    const leiste = screen.getByTestId('kanal-leiste');
    const knopf = within(leiste).getByRole('button', { name: 'Kanal anlegen' });
    // Kein Segment: die Tabliste besitzt nur die Kanäle.
    expect(knopf.closest('[role="tablist"]')).toBeNull();
    expect(within(screen.getByRole('tablist', { name: 'Kanal' })).getAllByRole('tab')).toHaveLength(
      1,
    );
    // Genau eine Anlage-Aktion auf der Seite.
    expect(screen.getAllByRole('button', { name: 'Kanal anlegen' })).toHaveLength(1);
  });

  it('legt per Enter im Namensfeld einen Kanal an, der als Segment erscheint und wählbar ist', async () => {
    const user = userEvent.setup();
    const { angelegt } = setupSchmal();
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Kanal anlegen' }));
    expect(await screen.findByRole('dialog', { name: 'Neuer Kanal' })).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Name'), 'Verpflegung{Enter}');

    await waitFor(() => expect(angelegt).toEqual([{ name: 'Verpflegung' }]));
    const segment = await screen.findByRole('tab', { name: 'Verpflegung' });
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'));

    await user.click(segment);
    await waitFor(() => expect(segment).toHaveAttribute('aria-selected', 'true'));
    expect(screen.queryByText('Erste Lage')).not.toBeInTheDocument();
  });

  it('zeigt ohne Schreibrecht keine Anlage, wie die Kanalliste ab md', async () => {
    setupSchmal('beobachter');
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    expect(screen.getByTestId('kanal-leiste')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kanal anlegen' })).not.toBeInTheDocument();
    // Erklärt wird es am Fuß, für Leiste und Spalte gleich (M16).
    expect(
      screen.getByText(/Einsatzleitung und dem Führungspersonal vorbehalten/i),
    ).toBeInTheDocument();
  });
});
