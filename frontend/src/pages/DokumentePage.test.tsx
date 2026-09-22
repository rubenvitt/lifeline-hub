import { http, HttpResponse } from 'msw';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { AuthProvider } from '../auth/AuthContext';
import { dokumentDownloadPfad } from '../api/dokumente';
import DokumentePage from './DokumentePage';

class FakeEventSource {
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const nutzer = {
  id: 1,
  anzeigename: 'Nutzer',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
};
const einsatzAktiv = {
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  org_id: 5,
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

function dokument(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    einsatz_id: 1,
    kategorie: 'lagekarte_plan',
    titel: 'Lageplan Nord',
    dateiname: 'lageplan-nord.pdf',
    mime: 'application/pdf',
    groesse: 2048,
    bezug_abschnitt_id: 3,
    bezug_abschnitt_name: 'EA Nord',
    etb_eintrag_id: 40,
    abgelegt_von_id: 1,
    abgelegt_von_name: 'Anna Meier',
    abgelegt_at: '2026-09-22 10:00:00',
    ...overrides,
  };
}

/** Macht den Query-String sichtbar — der Beleg, dass `?neu=1` verbraucht wurde. */
function SuchAnzeige() {
  return <span data-testid="suche">{useLocation().search}</span>;
}

let loeschAufrufe: string[] = [];

function rendere(
  einsatz: object,
  dokumente: object[],
  { route = '/einsaetze/1/dokumente', listeStatus = 200 } = {},
) {
  loeschAufrufe = [];
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/1/dokumente', () =>
      listeStatus === 200
        ? HttpResponse.json(dokumente)
        : new HttpResponse(null, { status: listeStatus }),
    ),
    http.delete('/api/einsaetze/1/dokumente/:dokId', ({ params }) => {
      loeschAufrufe.push(String(params.dokId));
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route
          path="/einsaetze/:id/dokumente"
          element={
            <>
              <SuchAnzeige />
              <DokumentePage />
            </>
          }
        />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

/** Der Dialog über seinen Titel, nicht über den zugänglichen Namen (antd verknüpft ihn in
 *  jsdom nicht zuverlässig). */
async function dialogAblegen() {
  const dialoge = await screen.findAllByRole('dialog');
  const treffer = dialoge.find((d) => within(d).queryByText('Dokument ablegen'));
  expect(treffer).toBeTruthy();
  return treffer!;
}

const kopfAktionen = () => document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;

describe('DokumentePage', () => {
  it('zeigt Titel als Download-Anker, Kategorie, Bezug, Datei, Verfasser und Zeit', async () => {
    // Über `xl`, damit die Dateispalte (abBreite: 'xl') im Tabellenzweig steht.
    setzeViewportBreite(1400);
    rendere(einsatzAktiv, [
      dokument(),
      dokument({
        id: 6,
        titel: 'Foto Einsatzstelle',
        kategorie: 'foto',
        bezug_abschnitt_id: null,
        bezug_abschnitt_name: null,
        bezug_etb_eintrag_id: 41,
        bezug_etb_lfd_nr: 17,
      }),
    ]);
    const link = await screen.findByRole('link', { name: 'Lageplan Nord' });
    expect(link).toHaveAttribute('href', dokumentDownloadPfad(1, 5));
    const zeile = screen.getByRole('row', { name: /Lageplan Nord/ });
    expect(within(zeile).getByText('Lagekarte/Plan')).toBeInTheDocument();
    expect(within(zeile).getByText('EA Nord')).toBeInTheDocument();
    expect(within(zeile).getByText(/lageplan-nord\.pdf · 2\.0 KB/)).toBeInTheDocument();
    expect(within(zeile).getByText(/Anna Meier/)).toBeInTheDocument();
    expect(within(zeile).getByText(/\d{6}SEP2026/)).toBeInTheDocument();
    const zweite = screen.getByRole('row', { name: /Foto Einsatzstelle/ });
    expect(within(zweite).getByText('ETB 17')).toBeInTheDocument();
  });

  it('trägt den Download-Anker auch im Kartenzweig', async () => {
    setzeViewportBreite(390);
    rendere(einsatzAktiv, [dokument()]);
    const link = await screen.findByRole('link', { name: 'Lageplan Nord' });
    expect(link).toHaveAttribute('href', dokumentDownloadPfad(1, 5));
    expect(document.querySelector('[data-lfh="datensicht-karte"]')).not.toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('zeigt den Leerzustand bei null Dokumenten und keinen Fehler', async () => {
    rendere(einsatzAktiv, []);
    expect(await screen.findByText('Noch keine Dokumente abgelegt.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('filtert über den Spaltenfilter „Kategorie"', async () => {
    rendere(einsatzAktiv, [
      dokument(),
      dokument({ id: 6, titel: 'Foto Einsatzstelle', kategorie: 'foto' }),
    ]);
    await screen.findByRole('link', { name: 'Foto Einsatzstelle' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Kategorie' }));
    await userEvent.click(await screen.findByTitle('Foto'));
    await vi.waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Lageplan Nord' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Foto Einsatzstelle' })).toBeInTheDocument();
  });

  it('Schreibrecht: „Dokument ablegen" steht im Kopf-Slot und öffnet den Dialog', async () => {
    rendere(einsatzAktiv, []);
    await screen.findByText('Noch keine Dokumente abgelegt.');
    const knopf = within(kopfAktionen()).getByRole('button', { name: 'Dokument ablegen' });
    expect(knopf).toBeEnabled();
    await userEvent.click(knopf);
    expect(await dialogAblegen()).toBeInTheDocument();
  });

  it('?neu=1 öffnet den Dialog', async () => {
    rendere(einsatzAktiv, [], { route: '/einsaetze/1/dokumente?neu=1' });
    expect(await dialogAblegen()).toBeInTheDocument();
  });

  it('?neu=1 öffnet den Dialog NICHT für Beobachter', async () => {
    rendere(einsatzBeobachter, [], { route: '/einsaetze/1/dokumente?neu=1' });
    // Synchronisationspunkt ist das Räumen des Parameters — erst danach hat der Effekt
    // entschieden. Ein Warten auf den Leertext allein reichte nicht: gemessen hängt ein
    // (fälschlich) geöffneter Dialog erst NACH dem Leertext ein, die Negativaussage wäre
    // trivial grün geblieben.
    await vi.waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(document.querySelector('.ant-modal')).toBeNull();
  });

  it('Beobachter: Knopf gesperrt statt fehlend, Rechte-Hinweis, kein Entfernen', async () => {
    rendere(einsatzBeobachter, [dokument()]);
    await screen.findByRole('link', { name: 'Lageplan Nord' });
    expect(within(kopfAktionen()).getByRole('button', { name: 'Dokument ablegen' })).toBeDisabled();
    expect(screen.getByText(/Dokumente ablegen und entfernen/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Dokument Lageplan Nord entfernen' }),
    ).not.toBeInTheDocument();
  });

  it('Schreibrecht: Entfernen je Zeile mit roter Rückfrage ruft das Löschen auf', async () => {
    rendere(einsatzAktiv, [dokument()]);
    const knopf = await screen.findByRole('button', { name: 'Dokument Lageplan Nord entfernen' });
    expect(knopf).toHaveClass('ant-btn-dangerous');
    expect(screen.queryByText(/Dokumente ablegen und entfernen/)).not.toBeInTheDocument();
    await userEvent.click(knopf);

    const rueckfrage = (await screen.findByText('Dokument entfernen?')).closest<HTMLElement>(
      '.ant-popover',
    )!;
    const ok = within(rueckfrage).getByRole('button', { name: 'Entfernen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(loeschAufrufe).toEqual([]);
    await userEvent.click(ok);
    await vi.waitFor(() => expect(loeschAufrufe).toEqual(['5']));
  });

  it('zeigt einen Fehler an der Stelle der Liste, wenn sie ohne Daten scheitert', async () => {
    rendere(einsatzAktiv, [], { listeStatus: 500 });
    expect(await screen.findByText('Dokumente konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Dokumente abgelegt.')).not.toBeInTheDocument();
    // Der Seitenrahmen steht trotzdem — der Fehler ersetzt nur die Liste.
    expect(screen.getByRole('heading', { level: 1, name: /Dokumente/ })).toBeInTheDocument();
  });

  it('zeigt einen Seitenfehler, wenn der Einsatz nicht lädt', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/einsaetze/1/dokumente', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/dokumente" element={<DokumentePage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/1/dokumente' },
    );
    expect(await screen.findByText('Einsatz nicht gefunden oder kein Zugriff')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
