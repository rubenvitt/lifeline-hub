import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BenachrichtigungAnzeige, BenachrichtigungEreignis } from '../api/types';
import { BENACHRICHTIGUNG_WINDOW_EVENT } from '../live/benachrichtigungListener';
import { server } from '../test/server';
import { spieleAlarmTon } from './alarmTon';
import OrgBenachrichtigungen from './OrgBenachrichtigungen';

vi.mock('./alarmTon', async (original) => ({
  ...(await original<typeof import('./alarmTon')>()),
  spieleAlarmTon: vi.fn(),
}));

const NEUER_EINSATZ: BenachrichtigungAnzeige = {
  id: 80,
  einsatz_id: 9,
  art: 'einsatz_neu',
  stufe: 'hinweis',
  bezug_typ: 'einsatz',
  bezug_id: 9,
  erstellt_at: '2026-10-14 12:05:00',
  titel: 'Neuer Einsatz',
  detail: 'Hochwasser Elbe',
  pfad: '/einsaetze/9',
};

const NEUER_AUFTRAG: BenachrichtigungAnzeige = {
  ...NEUER_EINSATZ,
  id: 81,
  einsatz_id: 3,
  art: 'auftrag_erteilt',
  bezug_typ: 'auftrag',
  bezug_id: 12,
  titel: 'Neuer Auftrag',
  detail: 'Auftrag #12',
  pfad: '/einsaetze/3/auftraege?auftrag=12',
};

function live(b: BenachrichtigungAnzeige) {
  const detail: BenachrichtigungEreignis = {
    einsatz_id: b.einsatz_id,
    benachrichtigung_id: b.id,
    art: b.art,
    stufe: b.stufe,
    bezug_typ: b.bezug_typ,
    bezug_id: b.bezug_id,
    quittiert: false,
  };
  act(() => {
    window.dispatchEvent(new CustomEvent(BENACHRICHTIGUNG_WINDOW_EVENT, { detail }));
  });
}

function Ort() {
  const location = useLocation();
  return <output data-testid="route">{location.pathname}</output>;
}

function renderOrg() {
  return render(
    <AntApp>
      <MemoryRouter initialEntries={['/einsaetze']}>
        <OrgBenachrichtigungen />
        <Routes>
          <Route path="*" element={<Ort />} />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  );
}

function serverMit(offen: BenachrichtigungAnzeige[] = []) {
  const abgerufen: number[] = [];
  const quittiert: number[] = [];
  server.use(
    http.get('/api/benachrichtigungen/:id', ({ params }) => {
      abgerufen.push(Number(params.id));
      const b = [NEUER_EINSATZ, NEUER_AUFTRAG].find((x) => x.id === Number(params.id));
      return b ? HttpResponse.json(b) : new HttpResponse(null, { status: 404 });
    }),
    http.get('/api/benachrichtigungen', () => HttpResponse.json(offen)),
    http.post('/api/benachrichtigungen/:id/quittieren', ({ params }) => {
      quittiert.push(Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { abgerufen, quittiert };
}

beforeEach(() => vi.mocked(spieleAlarmTon).mockClear());

describe('Org-Zentrale (tasks.md 2.5)', () => {
  it('zeigt „Neuer Einsatz“ im Org-Layout; „Öffnen“ führt in den Einsatz und quittiert', async () => {
    const s = serverMit();
    renderOrg();
    live(NEUER_EINSATZ);

    expect(await screen.findByText('Neuer Einsatz')).toBeInTheDocument();
    expect(screen.getByText('Hochwasser Elbe')).toBeInTheDocument();
    expect(spieleAlarmTon).toHaveBeenCalledExactlyOnceWith('dezent');
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/9');
    await waitFor(() => expect(s.quittiert).toEqual([80]));
  });

  it('nimmt keine Einsatz-Arten an: die gehören in die Zentrale des Einsatzes', async () => {
    const s = serverMit();
    renderOrg();
    live(NEUER_AUFTRAG);
    await act(async () => {});
    expect(s.abgerufen).toEqual([]);
    expect(screen.queryByText('Neuer Auftrag')).not.toBeInTheDocument();
  });

  it('reicht beim Laden nur die offenen Org-Arten nach', async () => {
    serverMit([NEUER_AUFTRAG, NEUER_EINSATZ]);
    renderOrg();
    expect(await screen.findByText('Neuer Einsatz')).toBeInTheDocument();
    expect(screen.queryByText('Neuer Auftrag')).not.toBeInTheDocument();
    expect(screen.getByText('Hochwasser Elbe · 14:05')).toBeInTheDocument();
  });

  it('der Sammeltoast der Org-Zentrale springt in die Einsatzliste', async () => {
    const liste = [1, 2, 3, 4].map((n) => ({
      ...NEUER_EINSATZ,
      id: 90 + n,
      einsatz_id: 20 + n,
      detail: `Einsatz ${n}`,
    }));
    serverMit(liste);
    renderOrg();
    expect(await screen.findByText('3 weitere Hinweise')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsätzen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze');
  });
});
