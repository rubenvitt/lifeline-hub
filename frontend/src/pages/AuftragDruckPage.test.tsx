import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { EINSATZ_KEYS } from '../api/queryKeys';
import type { Auftrag } from '../api/types';
import { druckAuftrag, druckEmpfaenger } from '../auftraege/auftragDruckTestdaten';
import AuftragDruckPage from './AuftragDruckPage';

/** Druckansicht eines Auftrags (LLH-1171, Change `ianaw5k1-auftrag-drucken` D2/D3). */

const EINSATZ = {
  id: 5,
  bezeichnung: 'Hochwasser Nord',
  einsatznummer_intern: 'E-2026-0005',
  status: 'aktiv',
  meine_rolle: 'beobachter',
};

function renderPage(
  antwort: () => Response | Promise<Response>,
  pfad = '/einsaetze/5/auftraege/31/druck',
  client = neuerQueryClient(),
) {
  const abrufe = { auftrag: 0 };
  server.use(
    http.get('/api/einsaetze/5', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/5/auftraege/31', () => {
      abrufe.auftrag += 1;
      return antwort();
    }),
  );
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/auftraege/:auftragId/druck" element={<AuftragDruckPage />} />
      <Route path="/einsaetze/:id/auftraege" element={<div>Aufträge-Liste</div>} />
    </Routes>,
    { route: pfad, client },
  );
  return abrufe;
}

const druckKnopf = () => screen.getByRole('button', { name: 'Drucken / als PDF' });
async function fertig() {
  await waitFor(() => expect(druckKnopf()).toBeEnabled());
}
const kopf = () => document.querySelector<HTMLElement>('[data-lfh="druckkopf"]')!;

describe('AuftragDruckPage', () => {
  it('zeigt genau eine Druckwurzel mit sichtbarem Kopf „Auftrag #4“ und dem Blatt', async () => {
    renderPage(() => HttpResponse.json(druckAuftrag()));
    await fertig();
    const wurzeln = document.querySelectorAll('[data-lfh="druckwurzel"]');
    expect(wurzeln).toHaveLength(1);
    expect(wurzeln[0]).toContainElement(kopf());
    expect(kopf()).toHaveTextContent('Auftrag');
    expect(kopf()).toHaveTextContent('#4');
    expect(kopf()).toHaveTextContent('Hochwasser Nord');
    expect(kopf()).toHaveTextContent('E-2026-0005');
    // Stand als taktische DTG des Abrufs, in der Zone der Organisation.
    expect(kopf().textContent).toMatch(/Stand\s*\d{6}[a-z]{3}\d{2}/);
    expect(
      within(wurzeln[0] as HTMLElement).getByRole('heading', { level: 3, name: 'Quittung' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Wasserversorgung von Hydrant H12 aufbauen')).toBeInTheDocument();
  });

  it('sperrt „Drucken“, solange der Auftrag lädt', async () => {
    let freigeben!: () => void;
    const warten = new Promise<void>((r) => (freigeben = r));
    renderPage(async () => {
      await warten;
      return HttpResponse.json(druckAuftrag());
    });
    await waitFor(() => expect(druckKnopf()).toBeDisabled());
    expect(document.querySelector('[data-lfh="druckwurzel"]')).toBeNull();
    freigeben();
    await fertig();
  });

  it('ist ein Schnappschuss: das Ereignis `auftrag` ändert das Blatt nicht, „Neu laden“ schon', async () => {
    const client = neuerQueryClient();
    let stand: Auftrag = druckAuftrag({ empfaenger: [druckEmpfaenger(2, 'Logistiktrupp', null)] });
    const abrufe = renderPage(() => HttpResponse.json(stand), undefined, client);
    await fertig();
    expect(screen.getByText('nicht quittiert')).toBeInTheDocument();

    stand = druckAuftrag({
      empfaenger: [druckEmpfaenger(2, 'Logistiktrupp', '2026-06-11 08:15:00')],
    });
    // Das Live-Ereignis `auftrag` invalidiert den Prefix `auftraege` (live/…, EINSATZ_STREAM_EVENTS).
    await act(() => client.invalidateQueries({ queryKey: [EINSATZ_KEYS.auftraege] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(abrufe.auftrag).toBe(1);
    expect(screen.getByText('nicht quittiert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(screen.queryByText('nicht quittiert')).toBeNull());
    expect(abrufe.auftrag).toBe(2);
    // Statt „nicht quittiert“ steht jetzt der Zeitpunkt der Quittung als DTG (Minute 15, die
    // Stunde hängt an der Zone der Test-Umgebung).
    const wert = screen.getByText('Logistiktrupp', { selector: 'dt' }).nextElementSibling;
    expect(wert?.textContent).toMatch(/^11\d{2}15jun26$/);
  });

  it('unbekannter Auftrag: „nicht gefunden“ mit Rückweg, kein Druck', async () => {
    renderPage(() => HttpResponse.json({ error: 'Auftrag nicht gefunden' }, { status: 404 }));
    expect(await screen.findByText('Auftrag nicht gefunden')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zurück zu Aufträge/Befehle' })).toHaveAttribute(
      'href',
      '/einsaetze/5/auftraege?auftrag=31',
    );
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
    expect(document.querySelector('[data-lfh="druckwurzel"]')).toBeNull();
  });

  it('ohne Zugriff (403): „Kein Zugriff“, kein Druck', async () => {
    renderPage(() => HttpResponse.json({ error: 'Modul gesperrt' }, { status: 403 }));
    expect(await screen.findByText('Kein Zugriff auf die Aufträge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
  });

  it('anderer Fehler: Grund mit „Erneut laden“', async () => {
    let fehler = true;
    renderPage(() =>
      fehler
        ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
        : HttpResponse.json(druckAuftrag()),
    );
    expect(await screen.findByText('Der Auftrag konnte nicht geladen werden')).toBeInTheDocument();
    fehler = false;
    fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
    await fertig();
  });

  it('„Zurück zu Aufträge/Befehle“ führt auf die Liste mit diesem Auftrag gewählt', async () => {
    renderPage(() => HttpResponse.json(druckAuftrag()));
    await fertig();
    const zurueck = screen.getByRole('link', { name: 'Zurück zu Aufträge/Befehle' });
    expect(zurueck).toHaveAttribute('href', '/einsaetze/5/auftraege?auftrag=31');
    fireEvent.click(zurueck);
    expect(await screen.findByText('Aufträge-Liste')).toBeInTheDocument();
  });

  it('ungültige Auftrags-ID führt auf die Liste', async () => {
    renderPage(() => HttpResponse.json(druckAuftrag()), '/einsaetze/5/auftraege/abc/druck');
    expect(await screen.findByText('Aufträge-Liste')).toBeInTheDocument();
  });
});
