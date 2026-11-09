import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanungListeneintrag } from '../api/types';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import PlanungenPage, { loeschHinweisTag } from './PlanungenPage';

/** Liste der Planungen (LLH-1586, Spec `vorplanung`). */

const JETZT = new Date('2027-06-01T10:00:00Z');

const eintrag = (
  e: Partial<PlanungListeneintrag> & { id: number; bezeichnung: string },
): PlanungListeneintrag => ({
  einsatzart: 'sanitaetsdienst',
  von: '2027-06-12 06:00:00',
  bis: '2027-06-12 20:00:00',
  posten_anzahl: 2,
  bloecke_anzahl: 3,
  loeschung_at: '2027-09-10 20:00:00',
  ...e,
});

const LISTE: PlanungListeneintrag[] = [
  eintrag({
    id: 5,
    bezeichnung: 'Stadtfest',
    ort: 'Marktplatz',
    kennzahlen: { soll: 12, ist: 9, offen: 3, konflikte: 1 },
  }),
  // Alt und bald gelöscht: ohne Kennzahlen, mit Löschtag.
  eintrag({
    id: 6,
    bezeichnung: 'Frühjahrsmarkt',
    von: '2027-03-01 08:00:00',
    bis: '2027-03-01 18:00:00',
    loeschung_at: '2027-06-08 18:00:00',
  }),
];

function setup(liste = LISTE) {
  server.use(
    meHandler(adminFixture()),
    http.get('/api/planungen', () => HttpResponse.json(liste)),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/planungen" element={<PlanungenPage />} />
      <Route path="/planungen/:planungId" element={<div>Planung geöffnet</div>} />
    </Routes>,
    { route: '/planungen', datenRouter: true },
  );
}

const zeile = (text: string) => screen.getByText(text).closest('tr')!;

describe('PlanungenPage (LLH-1586)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(JETZT);
  });
  afterEach(() => vi.useRealTimers());

  it('listet Planungen mit Ort und Kennzahlen; ältere ohne Kennzahlen mit Strich', async () => {
    setup();
    await screen.findByText('Stadtfest');
    const stadtfest = within(zeile('Stadtfest'));
    expect(stadtfest.getByText('Marktplatz')).toBeInTheDocument();
    for (const zahl of ['12', '9', '3', '1']) expect(stadtfest.getByText(zahl)).toBeInTheDocument();
    expect(within(zeile('Frühjahrsmarkt')).getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('nennt 14 Tage vor dem Löschen den Tag, sonst nicht', async () => {
    setup();
    await screen.findByText('Stadtfest');
    expect(within(zeile('Frühjahrsmarkt')).getByText(/^wird am .* gelöscht$/)).toBeInTheDocument();
    expect(within(zeile('Stadtfest')).queryByText(/gelöscht/)).toBeNull();
    const jetzt = JETZT.valueOf();
    expect(loeschHinweisTag('2027-06-15 10:00:00', jetzt)).not.toBeNull();
    expect(loeschHinweisTag('2027-06-15 10:05:00', jetzt)).toBeNull();
  });

  it('Anlegen schickt Bezeichnung und Zeitraum und öffnet die neue Planung', async () => {
    let body: unknown;
    server.use(
      http.post('/api/planungen', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            kopf: { id: 7 },
            posten: [],
            bloecke: [],
            helfer: [],
            kennzahlen: { soll: 0, ist: 0, offen: 0, konflikte: 0 },
          },
          { status: 201 },
        );
      }),
    );
    setup([]);
    expect(await screen.findByText('Noch keine Planungen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Planung anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Planung anlegen' });
    expect(within(dialog).getByText('Sanitätsdienst (Vorgabe)')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), ' Stadtfest ');
    await userEvent.type(within(dialog).getByPlaceholderText('Beginn'), '12.06.27 08:00');
    await userEvent.type(within(dialog).getByPlaceholderText('Ende'), '13.06.27 02:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Planung anlegen' }));
    await waitFor(() =>
      expect(body).toEqual({
        bezeichnung: 'Stadtfest',
        von: '2027-06-12 06:00:00',
        bis: '2027-06-13 00:00:00',
      }),
    );
    expect(await screen.findByText('Planung geöffnet')).toBeInTheDocument();
  });

  it('ein Zeitraum über 14 Tage wird abgewiesen, bevor er hinausgeht', async () => {
    const post = vi.fn();
    server.use(
      http.post('/api/planungen', () => {
        post();
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    setup([]);
    await userEvent.click(await screen.findByRole('button', { name: 'Planung anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Planung anlegen' });
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Zu lang');
    await userEvent.type(within(dialog).getByPlaceholderText('Beginn'), '01.06.27 08:00');
    await userEvent.type(within(dialog).getByPlaceholderText('Ende'), '20.06.27 08:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Planung anlegen' }));
    expect(await within(dialog).findByText('Höchstens 14 Tage')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
