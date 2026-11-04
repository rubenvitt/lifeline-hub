import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BenachrichtigungAnzeige, BenachrichtigungEreignis } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import AlarmZentrale from '../einsatz/AlarmZentrale';
import { BENACHRICHTIGUNG_WINDOW_EVENT } from '../live/benachrichtigungListener';
import {
  queueLeerenFuerTests,
  schreibaktionEinreihen,
  schreibaktionenLaden,
} from '../offline/queue';
import { useOfflineSync } from '../offline/useOfflineSync';
import { benutzerFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';
import { schliesseAlleDesktopAlarme } from './desktopAlarm';

/**
 * Einen einzelnen Eingang ohne Netz quittieren (LLH-1477): das Eingangsband der Einsatz-Zentrale
 * merkt vor statt zu scheitern, der Abgleich quittiert nach der Rückkehr genau einmal, und das
 * Nachreichen zeigt einen vorgemerkten Eingang nicht wieder.
 */

vi.mock('./webPush', async (original) => ({
  ...(await original<typeof import('./webPush')>()),
  schliessePushMeldungen: vi.fn(async () => undefined),
}));

vi.mock('./alarmTon', async (original) => ({
  ...(await original<typeof import('./alarmTon')>()),
  spieleAlarmTon: vi.fn(),
}));

const BENUTZER = 31;

function auftragEingang(id: number): BenachrichtigungAnzeige {
  return {
    id,
    einsatz_id: 1,
    art: 'auftrag_erteilt',
    stufe: 'hinweis',
    bezug_typ: 'auftrag',
    bezug_id: id,
    erstellt_at: '2026-10-21 12:05:00',
    titel: 'Neuer Auftrag',
    detail: `Auftrag #${id}`,
    pfad: `/einsaetze/1/auftraege?auftrag=${id}`,
  };
}

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

/** Der Server kennt diese Benachrichtigungen; `offen` liefert das Nachreichen. */
function serverMit(liste: BenachrichtigungAnzeige[], offen: BenachrichtigungAnzeige[] = []) {
  const quittiert: number[] = [];
  server.use(
    http.get('/api/benachrichtigungen/:id', ({ params }) => {
      const b = liste.find((x) => x.id === Number(params.id));
      return b ? HttpResponse.json(b) : HttpResponse.json({ error: 'weg' }, { status: 404 });
    }),
    http.get('/api/benachrichtigungen', () => HttpResponse.json(offen)),
    http.get('/api/einsaetze/:id/benachrichtigungen', () =>
      HttpResponse.json({ eintraege: liste, ungelesen: liste.length }),
    ),
    http.post('/api/benachrichtigungen/:id/quittieren', ({ params }) => {
      quittiert.push(Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { quittiert };
}

function Ort() {
  const l = useLocation();
  return <output data-testid="route">{`${l.pathname}${l.search}`}</output>;
}

/**
 * Der globale Abgleich der Offline-Queue, wie ihn der Rahmen der App hält; die Zentrale steht wie
 * in der App erst mit angemeldetem Benutzer.
 */
function Rahmen() {
  const { benutzer } = useAuth();
  useOfflineSync(benutzer?.id);
  return benutzer ? (
    <>
      <AlarmZentrale einsatzId={1} />
      <output data-testid="angemeldet" />
    </>
  ) : null;
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <Rahmen />
            <Ort />
          </>
        }
      />
    </Routes>,
    { route: '/einsaetze/1/lagekarte' },
  );
}

function band(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-lfh="eingangsband"]');
  if (!el) throw new Error('kein Eingangsband');
  return el;
}

beforeEach(async () => {
  setzeViewportBreite(1366);
  server.use(meHandler(benutzerFixture({ id: BENUTZER })));
  await queueLeerenFuerTests();
});

afterEach(() => {
  schliesseAlleDesktopAlarme();
  setzeViewportBreite(VIEWPORT_STANDARD);
  setzeOnline(true);
});

describe('Eingang einzeln quittieren ohne Netz (LLH-1477)', () => {
  it('„Öffnen“ im Eingangsband: springt, merkt vor, quittiert nach der Rückkehr genau einmal', async () => {
    const b = auftragEingang(1701);
    const s = serverMit([b]);
    rendern();
    await screen.findByTestId('angemeldet');
    live(b);
    await waitFor(() => expect(within(band()).getByText('Auftrag #1701')).toBeInTheDocument());

    setzeOnline(false);
    await userEvent.click(within(band()).getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/auftraege?auftrag=1701');
    await waitFor(async () =>
      expect((await schreibaktionenLaden(BENUTZER, 1)).map((z) => z.aktion)).toEqual([
        { art: 'benachrichtigung_quittiert', daten: { benachrichtigung_id: 1701 } },
      ]),
    );
    expect(s.quittiert).toEqual([]);

    setzeOnline(true);
    await waitFor(() => expect(s.quittiert).toEqual([1701]));
    await waitFor(async () => expect(await schreibaktionenLaden(BENUTZER, 1)).toEqual([]));
  });

  it('das Nachreichen zeigt einen vorgemerkten Eingang nicht wieder', async () => {
    const vorgemerkt = auftragEingang(1801);
    const offen = auftragEingang(1802);
    await schreibaktionEinreihen(BENUTZER, 1, {
      art: 'benachrichtigung_quittiert',
      daten: { benachrichtigung_id: 1801 },
    });
    // Das Senden scheitert an der Leitung: die Zeile bleibt, wie vor dem Abgleich.
    serverMit([vorgemerkt, offen], [offen, vorgemerkt]);
    server.use(http.post('/api/benachrichtigungen/:id/quittieren', () => HttpResponse.error()));
    rendern();

    await waitFor(() => expect(within(band()).getByText('Auftrag #1802')).toBeInTheDocument());
    expect(within(band()).queryByText('Auftrag #1801')).toBeNull();
  });
});
