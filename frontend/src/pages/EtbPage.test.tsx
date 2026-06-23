import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { entwuerfeLaden, entwuerfeLeerenFuerTests } from '../etb/entwuerfe/entwurfStore';
import { queueLeerenFuerTests } from '../offline/queue';
import EtbPage from './EtbPage';

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  await queueLeerenFuerTests();
  localStorage.clear();
});

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: 'THW', status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
};
const eintrag = {
  id: 1, lfd_nr: 1, typ: 'meldung', inhalt: 'Erste Meldung', von: null, an: null,
  meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Admin',
  ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
  erfasst_lokal_at: null, berichtigt_eintrag_id: null,
};

/** Zeigt den aktuellen Search-String im DOM — ermöglicht Param-Bereinigung zu prüfen. */
function OrtSpy() {
  const ort = useLocation();
  return <div data-testid="ort-suche">{ort.search}</div>;
}

function setupMSW() {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/etb', () => HttpResponse.json([eintrag])),
    // Schnellerfassung lädt via useFunkrufnamen disponierte Fahrzeuge/Einheiten
    // (Absender/Empfänger-Vorschläge). Leere Listen genügen für diesen Test.
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    // Auftrags-Ziele für das ETB→Auftrag-Formular (LFH-112).
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
  );
}

function setup(route = '/einsaetze/7/etb') {
  setupMSW();
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
      </Routes>
      <OrtSpy />
    </AuthProvider>,
    { route },
  );
}

describe('EtbPage', () => {
  it('zeigt Einsatz-Bezeichnung und ETB-Einträge', async () => {
    setup();
    // Bezeichnung erscheint als Überschrift (zusätzlich in der Breadcrumb-Zeile) → gezielt die Überschrift prüfen.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Hochwasser Nord' })).toBeInTheDocument(),
    );
    expect(await screen.findByText('Erste Meldung')).toBeInTheDocument();
  });

  it('hebt per ?eintrag=<id> den geladenen Eintrag hervor und räumt den Param (LFH-25)', async () => {
    const { container } = setup('/einsaetze/7/etb?eintrag=1');
    await screen.findByText('Erste Meldung');
    await waitFor(() =>
      expect(container.querySelector('[data-row-key="1"]')).toHaveClass('zeile-hervorgehoben'),
    );
    // Adressier-Param wird nach dem Anwenden geräumt (apply-then-clean).
    await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent(''));
  });

  it('lädt ältere Seiten nach, bis der ?eintrag=<id> gefunden ist (laden-bis-gefunden)', async () => {
    const seite1 = Array.from({ length: 100 }, (_, i) => ({
      ...eintrag, id: 101 + i, lfd_nr: 200 - i, inhalt: `Eintrag ${101 + i}`,
    }));
    const ziel = { ...eintrag, id: 5, lfd_nr: 1, inhalt: 'Ziel-Eintrag' };
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/etb', ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json(url.searchParams.has('before_lfd_nr') ? [ziel] : seite1);
      }),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
        <OrtSpy />
      </AuthProvider>,
      { route: '/einsaetze/7/etb?eintrag=5' },
    );
    // Der Ziel-Eintrag liegt erst auf Seite 2 → muss automatisch nachgeladen werden.
    expect(await screen.findByText('Ziel-Eintrag')).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector('[data-row-key="5"]')).toHaveClass('zeile-hervorgehoben'),
    );
  });

  it('erteilt aus einem ETB-Eintrag einen Auftrag (Text vorbefüllt, POST an /etb/:id/auftrag)', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/einsaetze/7/etb/1/auftrag', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 42 }, { status: 201 });
      }),
    );
    setup();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Auftrag erteilen' }));
    // Auftragstext ist aus dem Eintragstext vorbefüllt.
    expect(await screen.findByDisplayValue('Erste Meldung')).toBeInTheDocument();
    // Einen Funktions-Empfänger ergänzen (Pflicht: >=1 Empfänger).
    await user.type(screen.getByPlaceholderText(/S3, Fachberater/), 'S3');
    // Modal-Submit ("Auftrag erteilen") ist der zweite gleichnamige Button (Trigger + Submit).
    const buttons = screen.getAllByRole('button', { name: 'Auftrag erteilen' });
    await user.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.auftrag_text).toBe('Erste Meldung');
    expect(body!.empfaenger).toEqual([{ empfaenger_typ: 'funktion', funktion_text: 'S3' }]);
  });

  it('erfasst einen neuen Eintrag über den Entwurf-Tab (POST an /etb)', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/einsaetze/7/etb', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...eintrag, id: 2, lfd_nr: 2, inhalt: 'Neuer Eintrag X' }, { status: 201 });
      }),
    );
    setup();
    const user = userEvent.setup();
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await user.type(feld, 'Neuer Eintrag X{Enter}');
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.inhalt).toBe('Neuer Eintrag X');
  });

  it('entfernt den Entwurf auch bei Offline-Enqueue (Netzwerkfehler → eingereiht statt abgelehnt)', async () => {
    // erfasseEtb wirft bei Netzwerkfehler einen TypeError → useEtbErfassung reiht offline ein
    // und RESOLVED (kein throw). Der Entwurf muss trotzdem entfernt werden (Spec: weg, sobald
    // erfassen ohne Exception zurückkehrt — Server-Erfolg ODER offline eingereiht).
    server.use(http.post('/api/einsaetze/7/etb', () => HttpResponse.error()));
    setup();
    const user = userEvent.setup();
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await user.type(feld, 'Offline-Eintrag{Enter}');
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(0));
  });

  it('legt aus einem ETB-Eintrag eine Wiedervorlage mit ETB-Bezug an', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/einsaetze/7/erinnerungen', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 99 }, { status: 201 });
      }),
    );
    setup();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Wiedervorlage' }));
    // Titel ist aus dem Eintragstext vorbefüllt.
    expect(await screen.findByDisplayValue(/Wiedervorlage: Erste Meldung/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.bezug_typ).toBe('etb');
    expect(body!.bezug_id).toBe(1);
    expect(body!.titel).toMatch(/Erste Meldung/);
  });

  it('verarbeitet ?neu=1 und entfernt den Param', async () => {
    setup('/einsaetze/7/etb?neu=1');
    // Erfassungszeile ist bei Schreibrecht (aktiv + einsatzleitung) vorhanden.
    await waitFor(() =>
      expect(document.querySelector('.etb-erfassung-sticky')).toBeTruthy(),
    );
    // Der ?neu=1-Handler muss den Param aus der URL entfernen.
    await waitFor(() =>
      expect(screen.getByTestId('ort-suche').textContent).not.toContain('neu'),
    );
  });
});
