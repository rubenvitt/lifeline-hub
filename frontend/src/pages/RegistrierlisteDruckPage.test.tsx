import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { RegistrierListe } from '../api/types';
import RegistrierlisteDruckPage from './RegistrierlisteDruckPage';

/**
 * Druckansicht der Registrierliste (LLH-1616, Spec `betreuung-registrierung`, „Registrierliste
 * drucken“, „Druck der Registrierliste wird je Person protokolliert“, „Gesundheitsangaben nur auf
 * Wunsch“): nur über den Druckabruf, Schalter in der Adresse, Zustände.
 */

const EINSATZ = {
  id: 5,
  bezeichnung: 'Hochwasser Nord',
  einsatznummer_intern: 'E-2026-0005',
  status: 'aktiv',
  meine_rolle: 'beobachter',
};

const LISTE: RegistrierListe = {
  stelle_id: 8,
  haushalte: [
    {
      id: 3,
      nummer: 1,
      bezugsperson_id: 21,
      bezugsperson_name: 'Weber, Anna',
      personen: [
        {
          id: 21,
          registrier_nr: 12,
          name: 'Weber',
          vorname: 'Anna',
          kostform: 'vegetarisch',
          erfasst_at: '2026-11-09 08:00:00',
        },
        {
          id: 22,
          registrier_nr: 13,
          name: 'Weber',
          vorname: 'Tom',
          kostform: 'normal',
          erfasst_at: '2026-11-09 08:00:00',
        },
      ],
    },
  ],
  ohne_haushalt: [],
};

function mitUnvertraeglichkeit(liste: RegistrierListe): RegistrierListe {
  const [h] = liste.haushalte;
  return {
    ...liste,
    haushalte: [
      { ...h, personen: [{ ...h.personen[0], unvertraeglichkeiten: 'Erdnüsse' }, h.personen[1]] },
    ],
  };
}

function renderPage(
  antwort: (mit: boolean) => Response = (mit) =>
    HttpResponse.json(mit ? mitUnvertraeglichkeit(LISTE) : LISTE),
  route = '/einsaetze/5/betreuung/8/registrierliste/druck',
) {
  const abrufe: string[] = [];
  let liste = 0;
  server.use(
    http.get('/api/einsaetze/5', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/5/betreuung', () =>
      HttpResponse.json({ stellen: [{ id: 8, bezeichnung: 'Turnhalle Ost' }] }),
    ),
    http.get('/api/einsaetze/5/betreuung/stellen/8/registrierungen', () => {
      liste += 1;
      return HttpResponse.json(LISTE);
    }),
    http.get('/api/einsaetze/5/betreuung/stellen/8/registrierungen/druck', ({ request }) => {
      const url = new URL(request.url);
      abrufe.push(url.search);
      return antwort(url.searchParams.get('unvertraeglichkeiten') === '1');
    }),
  );
  renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/betreuung/:stelleId/registrierliste/druck"
        element={<RegistrierlisteDruckPage />}
      />
      <Route path="/einsaetze/:id/betreuung/:stelleId" element={<div>Stelle</div>} />
    </Routes>,
    { route },
  );
  return { abrufe, liste: () => liste };
}

const druckKnopf = () => screen.getByRole('button', { name: 'Drucken / als PDF' });
async function fertig() {
  await waitFor(() => expect(druckKnopf()).toBeEnabled());
}
const wurzel = () => document.querySelector<HTMLElement>('[data-lfh="druckwurzel"]')!;

describe('RegistrierlisteDruckPage (LLH-1616)', () => {
  it('lädt nur über den Druckabruf, ohne Gesundheitsangaben, genau einmal', async () => {
    const draht = renderPage();
    await fertig();
    expect(draht.abrufe).toEqual(['']);
    expect(draht.liste()).toBe(0);
    expect(document.querySelectorAll('[data-lfh="druckwurzel"]')).toHaveLength(1);
    expect(screen.getByText('Zugriff wird protokolliert.')).toBeInTheDocument();
    expect(wurzel()).not.toHaveTextContent('Zugriff wird protokolliert.');
  });

  it('trägt Stelle, Umfang und Stand im Druckkopf, ohne Gesundheitsangaben', async () => {
    renderPage();
    await fertig();
    const kopf = wurzel().querySelector<HTMLElement>('[data-lfh="druckkopf"]')!;
    expect(kopf).toHaveTextContent('Registrierliste');
    expect(kopf).toHaveTextContent('Turnhalle Ost');
    expect(kopf).toHaveTextContent('1 Haushalt · 2 Personen');
    expect(kopf).not.toHaveTextContent('Gesundheitsangaben');
    expect(within(wurzel()).getByRole('table', { name: 'Registrierte Personen' })).toBeVisible();
  });

  it('der Schalter lädt die Fassung mit Unverträglichkeiten neu und nennt sie im Kopf', async () => {
    const draht = renderPage();
    await fertig();
    await userEvent.click(screen.getByRole('switch', { name: 'Unverträglichkeiten mitdrucken' }));
    await waitFor(() => expect(within(wurzel()).getByText('Erdnüsse')).toBeInTheDocument());
    expect(draht.abrufe).toEqual(['', '?unvertraeglichkeiten=1']);
    expect(wurzel().querySelector('[data-lfh="druckkopf"]')).toHaveTextContent(
      'Gesundheitsangaben',
    );
  });

  it('übernimmt die Wahl aus der Adresse', async () => {
    const draht = renderPage(
      undefined,
      '/einsaetze/5/betreuung/8/registrierliste/druck?unvertraeglichkeiten=1',
    );
    await fertig();
    expect(draht.abrufe).toEqual(['?unvertraeglichkeiten=1']);
    expect(screen.getByRole('switch', { name: 'Unverträglichkeiten mitdrucken' })).toBeChecked();
  });

  it('„Neu laden“ ruft erneut ab', async () => {
    const draht = renderPage();
    await fertig();
    await userEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(draht.abrufe).toHaveLength(2));
  });

  it('leere Stelle: kein Druckknopf, ein Satz statt Tabelle', async () => {
    renderPage(() => HttpResponse.json({ stelle_id: 8, haushalte: [], ohne_haushalt: [] }));
    await screen.findByText('An dieser Stelle ist niemand registriert.');
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).not.toBeInTheDocument();
  });

  it('403: kein Zugriff, kein Druckknopf, kein Wiederholungsversuch', async () => {
    const draht = renderPage(() => HttpResponse.json({ error: 'verboten' }, { status: 403 }));
    await screen.findByText('Kein Zugriff auf die Personen');
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).not.toBeInTheDocument();
    expect(draht.abrufe).toHaveLength(1);
  });

  it('404: Stelle nicht gefunden', async () => {
    renderPage(() => HttpResponse.json({ error: 'nicht gefunden' }, { status: 404 }));
    await screen.findByText('Stelle nicht gefunden');
  });
});
