import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import BereitstellungsraeumePage from './BereitstellungsraeumePage';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum, EinsatzAnzeige } from '../../api/types';
import { CommandPaletteProvider } from '../../command-palette/CommandPaletteProvider';

function einsatz(over: Partial<EinsatzAnzeige> = {}): EinsatzAnzeige {
  return {
    id: 1,
    bezeichnung: 'Lage',
    stichwort: null,
    status: 'aktiv',
    begonnen_at: 'x',
    abgeschlossen_at: null,
    abgeschlossen_von: null,
    einsatzart: 'realeinsatz',
    einsatznummer_intern: null,
    angelegt_at: 'x',
    leitstellen_nr: null,
    einsatzort: null,
    einsatzort_lat: null,
    einsatzort_lon: null,
    meldende_stelle: null,
    sachverhalt: null,
    anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung',
    org_id: 1,
    org_name: 'Org',
    ...over,
  };
}

function br(over: Partial<Bereitstellungsraum> = {}): Bereitstellungsraum {
  return {
    id: 1,
    einsatz_id: 1,
    abschnitt_id: null,
    bezeichnung: 'BR Ost',
    standort: null,
    notiz: null,
    status: 'aktiv',
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
    ...over,
  };
}

function renderPage() {
  return renderMitProviders(
    <CommandPaletteProvider>
      <Routes>
        <Route
          path="/einsaetze/:id/bereitstellungsraeume/liste"
          element={<BereitstellungsraeumePage />}
        />
      </Routes>
    </CommandPaletteProvider>,
    { route: '/einsaetze/1/bereitstellungsraeume/liste' },
  );
}

function EinsatzWechsel() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/einsaetze/2/bereitstellungsraeume/liste')}>
      Zu Einsatz B
    </button>
  );
}

function PfadProbe() {
  return <output data-testid="pfad">{useLocation().pathname}</output>;
}

function renderWechselPage() {
  return renderMitProviders(
    <CommandPaletteProvider>
      <EinsatzWechsel />
      <PfadProbe />
      <Routes>
        <Route
          path="/einsaetze/:id/bereitstellungsraeume/liste"
          element={<BereitstellungsraeumePage />}
        />
        <Route path="/einsaetze/:id/bereitstellungsraeume/:brId" element={<div>BR-DETAIL</div>} />
      </Routes>
    </CommandPaletteProvider>,
    { route: '/einsaetze/1/bereitstellungsraeume/liste' },
  );
}

describe('BereitstellungsraeumePage', () => {
  it('zeigt die Bereitstellungsräume der Lage', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([br()])),
    );
    renderPage();
    expect(await screen.findByText('BR Ost')).toBeInTheDocument();
  });

  /**
   * AK4-Regressionsklammer (LFH-331 · B3) zur Ebenen-Trennung D3: die Listen-Query
   * gehört an die Stelle der Liste, nicht in den Seitenguard. Vor dem Umbau blieb die
   * Seite bei gescheitertem Abruf im Ladebild stehen und sagte nie, was los war.
   *
   * Beide Hälften nennen dasselbe Leertext-Literal — die negative Zusicherung soll eine
   * Aussage über die Zustandsweiche sein, nicht über die Schreibweise eines Strings.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get(
        '/api/einsaetze/1/bereitstellungsraeume',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Bereitstellungsräume erfasst')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Liste den Leertext und KEINEN Fehler', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText('Noch keine Bereitstellungsräume erfasst')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Veralteter Stand = `isError` MIT Zeilen im Zwischenspeicher (D5) — nicht `isFetching`,
   * nicht `isStale`.
   *
   * Der Ablauf ist BEWUSST der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung. Ein bloß vorbefüllter Zwischenspeicher belegte den Produktionsweg nicht.
   * Vor dem Umbau verschwand die Zeile hier — die Einsatzkraft verlor Daten, die sie eben
   * noch hatte, und bekam dafür eine Fehlermeldung über etwas, das sie längst gelesen hatte.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([br()])),
    );
    const { client } = renderPage();
    await screen.findByText('BR Ost');

    server.use(
      http.get(
        '/api/einsaetze/1/bereitstellungsraeume',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.br(1) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie NICHT.
    expect(screen.getByText('BR Ost')).toBeInTheDocument();
    expect(
      screen.queryByText('Bereitstellungsräume konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  /**
   * Eine vollständig stornierte Liste ist ein echter Leerzustand: der Seitenfilter
   * (`storniert_at`) läuft durch dieselbe Weiche wie eine leere Antwort. Ohne diesen
   * Fall bliebe der Filter unbelegt, obwohl er die Menge auf null bringen kann.
   */
  it('behandelt eine ausschließlich stornierte Liste als Leerzustand', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([br({ storniert_at: '2026-07-29 10:00:00' })]),
      ),
    );
    renderPage();
    expect(await screen.findByText('Noch keine Bereitstellungsräume erfasst')).toBeInTheDocument();
    expect(screen.queryByText('BR Ost')).not.toBeInTheDocument();
  });

  /**
   * PIN auf die MESSACHSE der beiden Zustandsflaggen — die einzige Stelle im Bündel, an
   * der die Wahl überhaupt widerlegbar ist.
   *
   * Auf den übrigen sechs Seiten leben Suche und Filter IM Primitiv; dort steht neben der
   * ungefilterten Menge gar keine zweite Zahl, gegen die man messen könnte. Hier schon:
   * `sichtbar` liegt eine Zeile über den Flaggen, und wer sie „vereinfachend" einsetzt,
   * holt eine Spielart genau des Befunds zurück, den B3 behebt — alles storniert plus
   * gescheiterte Aktualisierung, und der Fehler verdrängt wieder eine Tabelle, die die
   * Einsatzkraft eben noch gelesen hat.
   *
   * Gemessen: an `alle.length` grün, an `sichtbar.length` rot („Bereitstellungsräume
   * konnten nicht geladen werden" tritt an die Stelle des Banners).
   *
   * Die Lage selbst ist die benannte Folge aus dem Dateikopf der Seite: das Banner steht
   * über einer leeren Tabelle. Das ist die ehrlichere der beiden Aussagen — der Bestand
   * IST leer, nur eben womöglich veraltet leer.
   */
  it('misst an der ungefilterten Menge: alles storniert + Fehler ergibt Banner, nicht Seitenfehler', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([br({ storniert_at: '2026-07-29 10:00:00' })]),
      ),
    );
    const { client } = renderPage();
    await screen.findByText('Noch keine Bereitstellungsräume erfasst');

    server.use(
      http.get(
        '/api/einsaetze/1/bereitstellungsraeume',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.br(1) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    expect(screen.getByText('Noch keine Bereitstellungsräume erfasst')).toBeInTheDocument();
    expect(
      screen.queryByText('Bereitstellungsräume konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  it('fokussiert Bezeichnung und legt per Enter aus diesem Feld an', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(br({ id: 2, bezeichnung: 'BR West' }), { status: 201 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    const bezeichnung = screen.getByPlaceholderText('z. B. BR Ost');
    await waitFor(() => expect(bezeichnung).toHaveFocus());
    await userEvent.keyboard('BR West{Enter}');

    await waitFor(() => expect(body).toMatchObject({ bezeichnung: 'BR West' }));
  });

  it('setzt beim Einsatzwechsel alle Werte des offenen BR-Drawers zurück', async () => {
    server.use(
      http.get('/api/einsaetze/:einsatzId', ({ params }) =>
        HttpResponse.json(einsatz({ id: Number(params.einsatzId) })),
      ),
      http.get('/api/einsaetze/:einsatzId/bereitstellungsraeume', () => HttpResponse.json([])),
    );
    renderWechselPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'BR Einsatz A');
    await userEvent.type(screen.getByLabelText('Standort (optional)'), 'Standort A');
    await userEvent.type(screen.getByLabelText('Notiz (optional)'), 'Notiz A');

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));

    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue(''));
    expect(screen.getByLabelText('Standort (optional)')).toHaveValue('');
    expect(screen.getByLabelText('Notiz (optional)')).toHaveValue('');
  });

  it('schließt den BR-Drawer mit Provider per Escape und setzt das Formular zurück', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Wird verworfen');

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Neu' }));

    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('');
  });

  it('lässt den Drawer und die Bezeichnung bei einem Anlegefehler stehen', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json({ error: 'Bereitstellungsraum abgelehnt' }, { status: 500 }),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    const bezeichnung = screen.getByPlaceholderText('z. B. BR Ost');
    await userEvent.type(bezeichnung, 'BR Fehler');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(await screen.findByText('Bereitstellungsraum abgelehnt')).toBeInTheDocument();
    expect(bezeichnung).toHaveValue('BR Fehler');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('navigiert nach Schließen während des Anlegens nicht verspätet', async () => {
    let postGestartet!: () => void;
    let antwortFreigeben!: () => void;
    const postStart = new Promise<void>((resolve) => {
      postGestartet = resolve;
    });
    const antwortGate = new Promise<void>((resolve) => {
      antwortFreigeben = resolve;
    });
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume', async () => {
        postGestartet();
        await antwortGate;
        return HttpResponse.json(br({ id: 22 }), { status: 201 });
      }),
    );
    renderWechselPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByPlaceholderText('z. B. BR Ost'), 'BR West{Enter}');
    await postStart;
    await userEvent.click(screen.getByRole('button', { name: /Close|Schliessen|Schließen/i }));
    await act(async () => {
      antwortFreigeben();
    });
    await screen.findByText('Bereitstellungsraum angelegt');

    expect(screen.getByTestId('pfad')).toHaveTextContent(
      '/einsaetze/1/bereitstellungsraeume/liste',
    );
  });

  it('bindet einen laufenden Auftrag an dessen Einsatz-ID', async () => {
    let postGestartet!: () => void;
    let antwortFreigeben!: () => void;
    const postStart = new Promise<void>((resolve) => {
      postGestartet = resolve;
    });
    const antwortGate = new Promise<void>((resolve) => {
      antwortFreigeben = resolve;
    });
    server.use(
      http.get('/api/einsaetze/:einsatzId', ({ params }) =>
        HttpResponse.json(einsatz({ id: Number(params.einsatzId) })),
      ),
      http.get('/api/einsaetze/:einsatzId/bereitstellungsraeume', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume', async () => {
        postGestartet();
        await antwortGate;
        return HttpResponse.json(br({ id: 23 }), { status: 201 });
      }),
    );
    renderWechselPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByPlaceholderText('z. B. BR Ost'), 'BR Nord{Enter}');
    await postStart;
    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    await waitFor(() => expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/2/'));
    await act(async () => {
      antwortFreigeben();
    });

    await waitFor(() =>
      expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/1/bereitstellungsraeume/23'),
    );
  });
});
