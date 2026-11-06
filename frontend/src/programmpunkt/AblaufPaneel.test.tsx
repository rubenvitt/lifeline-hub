import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Programmpunkt } from '../api/types';
import { serveruhrVergessenFuerTests } from '../offline/serveruhr';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { tippeZeit } from '../test/zeitEingabe';
import AblaufPaneel from './AblaufPaneel';

dayjs.extend(utc);

/**
 * Paneel „Ablauf“ der Einsatzdaten (LLH-1570, Spec `ablaufplan`). Nur `Date` steht still:
 * `userEvent`, MSW und antds Animationen laufen auf echten Timern (Muster `TerminPaneel.test.tsx`).
 */
const JETZT = new Date('2026-09-13T16:00:00Z');
const wireAb = (minuten: number) =>
  dayjs(JETZT).add(minuten, 'minute').utc().format('YYYY-MM-DD HH:mm:ss');

let punkte: Programmpunkt[];
let gesendet: { methode: string; pfad: string; body: unknown }[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(JETZT);
  serveruhrVergessenFuerTests();
  gesendet = [];
  punkte = [
    { id: 1, bezeichnung: 'Einlass', zeitpunkt_at: wireAb(-60) },
    { id: 2, bezeichnung: 'Feuerwerk', zeitpunkt_at: wireAb(90) },
  ];
  server.use(
    http.get('/api/einsaetze/1/programmpunkte', () => HttpResponse.json(punkte)),
    http.post('/api/einsaetze/1/programmpunkte', async ({ request }) => {
      const body = (await request.json()) as { bezeichnung: string; zeitpunkt_at: string };
      gesendet.push({ methode: 'POST', pfad: new URL(request.url).pathname, body });
      const neu = { id: 9, ...body };
      punkte = [...punkte, neu];
      return HttpResponse.json(neu, { status: 201 });
    }),
    http.patch('/api/einsaetze/1/programmpunkte/:pid', async ({ request, params }) => {
      const body = (await request.json()) as Partial<Programmpunkt>;
      gesendet.push({ methode: 'PATCH', pfad: new URL(request.url).pathname, body });
      const id = Number(params.pid);
      punkte = punkte.map((p) => (p.id === id ? { ...p, ...body } : p));
      return HttpResponse.json(punkte.find((p) => p.id === id));
    }),
    http.delete('/api/einsaetze/1/programmpunkte/:pid', ({ request, params }) => {
      gesendet.push({ methode: 'DELETE', pfad: new URL(request.url).pathname, body: null });
      punkte = punkte.filter((p) => p.id !== Number(params.pid));
      return new HttpResponse(null, { status: 204 });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  serveruhrVergessenFuerTests();
});

async function zeige(darfSchreiben = true) {
  renderMitProviders(<AblaufPaneel einsatzId={1} darfSchreiben={darfSchreiben} />);
  const paneel = screen.getByRole('region', { name: 'Ablauf' });
  await within(paneel).findByText('Feuerwerk');
  return paneel;
}

describe('AblaufPaneel', () => {
  it('zeigt die Programmpunkte nach Zeit, verstrichene bleiben stehen', async () => {
    const p = await zeige();
    const texte = within(p)
      .getAllByText(/Einlass|Feuerwerk/)
      .map((e) => e.textContent);
    expect(texte).toEqual(['Einlass', 'Feuerwerk']);
  });

  it('ohne Programmpunkt: „Kein Programmpunkt“, der Knopf steht im Kopf', async () => {
    punkte = [];
    renderMitProviders(<AblaufPaneel einsatzId={1} darfSchreiben />);
    const p = screen.getByRole('region', { name: 'Ablauf' });
    expect(await within(p).findByText('Kein Programmpunkt')).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: 'Programmpunkt' })).toBeInTheDocument();
  });

  it('legt einen Programmpunkt mit Bezeichnung und Zeitpunkt an', async () => {
    const user = userEvent.setup();
    const p = await zeige();
    await user.click(within(p).getByRole('button', { name: 'Programmpunkt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Programmpunkt anlegen' });
    await user.type(within(dialog).getByLabelText('Bezeichnung'), 'Ende');
    // ISO-Eingabe: eindeutig. Enter übernimmt die Zeit und sendet das Formular (Erfassungs-Norm).
    await tippeZeit(user, within(dialog).getByLabelText('Zeitpunkt'), wireAb(180).slice(0, 16));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0].methode).toBe('POST');
    expect(gesendet[0].body).toMatchObject({ bezeichnung: 'Ende' });
    expect(await within(p).findByText('Ende')).toBeInTheDocument();
  });

  it('ändert die Bezeichnung in der Zeile und sendet nur sie', async () => {
    const user = userEvent.setup();
    const p = await zeige();
    await user.click(
      within(p).getByRole('button', { name: 'Bezeichnung zu Feuerwerk bearbeiten' }),
    );
    const feld = within(p).getByRole('textbox', { name: /Bezeichnung/ });
    await user.clear(feld);
    await user.type(feld, 'Höhenfeuerwerk{Enter}');
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toEqual({
      methode: 'PATCH',
      pfad: '/api/einsaetze/1/programmpunkte/2',
      body: { bezeichnung: 'Höhenfeuerwerk' },
    });
  });

  it('löscht nach Rückfrage', async () => {
    const user = userEvent.setup();
    const p = await zeige();
    await user.click(within(p).getByRole('button', { name: 'Feuerwerk löschen' }));
    await user.click(await screen.findByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      methode: 'DELETE',
      pfad: '/api/einsaetze/1/programmpunkte/2',
    });
    await waitFor(() => expect(within(p).queryByText('Feuerwerk')).toBeNull());
  });

  it('ohne Schreibrecht: nur lesen, kein Knopf, kein Löschen', async () => {
    const p = await zeige(false);
    expect(within(p).queryByRole('button', { name: 'Programmpunkt' })).toBeNull();
    expect(within(p).queryByRole('button', { name: /löschen/ })).toBeNull();
    expect(within(p).queryByRole('button', { name: /bearbeiten/ })).toBeNull();
  });
});
