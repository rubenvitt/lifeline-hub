import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { StammdatenSchnappschuss, StammdatenVorschau } from '../api/types';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import SchnappschussHinweis from './SchnappschussHinweis';

/**
 * Hinweis auf offene Schnappschüsse des Stammdaten-Abrufs (LLH-1194): je offenem einer mit
 * „Prüfen“; ohne offene nichts, ohne Admin-Recht keine Anfrage.
 */

const LISTE = '/api/master-data/import/snapshots';

const SCHNAPPSCHUSS: StammdatenSchnappschuss = {
  id: 's1',
  adapter_id: 'a1',
  adapter_name: 'Helfer',
  herkunft: 'Helferverwaltung',
  anzahl: { fahrzeuge: 0, personal: 2, qualifikationen: 0 },
  abgerufen_at: '2026-11-24 08:15:00',
};

const NULL = {
  neu: 0,
  ergaenzt: 0,
  geaendert: 0,
  unveraendert: 0,
  ausgelassen: 0,
  offen: 0,
  fehler: 0,
};

const VORSCHAU: StammdatenVorschau = {
  herkunft_noetig: false,
  herkunft_vorschlag: null,
  meldungen: [],
  nicht_uebernommen: [],
  qualifikationen: [],
  uebernehmbar: true,
  zaehlung: { fahrzeuge: NULL, personal: { ...NULL, neu: 1 }, qualifikationen: NULL },
  zeilen: [
    {
      art: 'personal',
      zeile: 1,
      anzeige: 'Albers, Jana',
      ergebnis: 'neu',
      grund: null,
      hinweise: [],
      kandidaten: [],
      aenderungen: [],
      wahl: null,
    },
  ],
};

function liste(eintraege: StammdatenSchnappschuss[], zaehler?: { n: number }) {
  return http.get(LISTE, () => {
    if (zaehler) zaehler.n += 1;
    return HttpResponse.json({ schnappschuesse: eintraege });
  });
}

describe('SchnappschussHinweis', () => {
  it('zeigt je offenem Schnappschuss einen Hinweis mit Herkunft und Zeit', async () => {
    server.use(meHandler(adminFixture()), liste([SCHNAPPSCHUSS]));
    renderMitProviders(<SchnappschussHinweis />);
    const hinweis = await screen.findByText(
      /^Neue Personaldaten aus Helferverwaltung vom .+ zum Prüfen$/,
    );
    expect(hinweis).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prüfen' })).toBeEnabled();
  });

  it('rendert ohne offene Schnappschüsse nichts', async () => {
    const zaehler = { n: 0 };
    server.use(meHandler(adminFixture()), liste([], zaehler));
    renderMitProviders(<SchnappschussHinweis />);
    await waitFor(() => expect(zaehler.n).toBe(1));
    expect(document.querySelector('[data-lfh="schnappschuss-hinweise"]')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fragt ohne Admin-Recht nichts an', async () => {
    const zaehler = { n: 0 };
    server.use(meHandler(benutzerFixture({ id: 2 })), liste([SCHNAPPSCHUSS], zaehler));
    renderMitProviders(<SchnappschussHinweis />);
    // Warten, bis der Benutzer geladen ist; danach darf keine Anfrage folgen.
    await new Promise((r) => setTimeout(r, 50));
    expect(zaehler.n).toBe(0);
    expect(document.querySelector('[data-lfh="schnappschuss-hinweise"]')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('zeigt nur die Schnappschüsse des genannten Adapters', async () => {
    server.use(
      meHandler(adminFixture()),
      liste([SCHNAPPSCHUSS, { ...SCHNAPPSCHUSS, id: 's2', adapter_id: 'a2', herkunft: 'Andere' }]),
    );
    renderMitProviders(<SchnappschussHinweis adapterId="a2" />);
    expect(await screen.findByText(/^Neue Personaldaten aus Andere vom/)).toBeInTheDocument();
    expect(screen.queryByText(/aus Helferverwaltung/)).not.toBeInTheDocument();
  });

  it('„Prüfen“ öffnet den Dialog mit der Quelle Schnappschuss, ohne Dateischritt', async () => {
    const vorschauKoerper: unknown[] = [];
    server.use(
      meHandler(adminFixture()),
      liste([SCHNAPPSCHUSS]),
      http.get('/api/qualifications', () => HttpResponse.json([])),
      http.post(`${LISTE}/s1/preview`, async ({ request }) => {
        vorschauKoerper.push(await request.json());
        return HttpResponse.json(VORSCHAU);
      }),
    );
    renderMitProviders(<SchnappschussHinweis />);
    await userEvent.click(await screen.findByRole('button', { name: 'Prüfen' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Albers, Jana')).toBeInTheDocument();
    expect(vorschauKoerper).toEqual([{ entscheidungen: { zeilen: [], qualifikationen: [] } }]);
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Datei wählen/ })).not.toBeInTheDocument();
  });

  it('nach dem Übernehmen verschwindet der Hinweis', async () => {
    let offen = [SCHNAPPSCHUSS];
    server.use(
      meHandler(adminFixture()),
      http.get(LISTE, () => HttpResponse.json({ schnappschuesse: offen })),
      http.get('/api/qualifications', () => HttpResponse.json([])),
      http.post(`${LISTE}/s1/preview`, () => HttpResponse.json(VORSCHAU)),
      http.post(`${LISTE}/s1`, () => {
        offen = [];
        return HttpResponse.json({
          zaehlung: { fahrzeuge: NULL, personal: { ...NULL, neu: 1 }, qualifikationen: NULL },
        });
      }),
    );
    renderMitProviders(<SchnappschussHinweis />);
    await userEvent.click(await screen.findByRole('button', { name: 'Prüfen' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Albers, Jana');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    // Das Ergebnis bleibt stehen, auch wenn die Liste inzwischen leer ist.
    expect(await within(dialog).findByText('Übernommen')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/^Neue Personaldaten aus/)).not.toBeInTheDocument(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
