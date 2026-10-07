import { http, HttpResponse } from 'msw';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { setzeViewportBreite } from '../test/viewport';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import type { Person } from '../api/types';
import PersonenPage from './PersonenPage';
import { queueLeerenFuerTests } from '../offline/queue';
import { offlineQuittungsKanalZuruecksetzenFuerTests } from '../offline/ereignisse';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

/**
 * Die Personenseite merkt sich Spalten und Kartenplan (LFH-949, D4): ein `person`-Ereignis, das
 * eine Person ändert, rendert nur deren Zeile. Gezählt wird über das `render` der Spalte „Nr.“,
 * die der Spy umhüllt.
 */
const gezeichnet = vi.hoisted(() => vi.fn<(id: number) => void>());
vi.mock('../personen/personenSpalten', async (original) => {
  const echt = await original<typeof import('../personen/personenSpalten')>();
  return {
    ...echt,
    personenSpalten: (...args: Parameters<typeof echt.personenSpalten>) =>
      echt.personenSpalten(...args).map((s) =>
        s.key === 'reg'
          ? {
              ...s,
              render: (wert: unknown, p: Person, i: number) => {
                gezeichnet(p.id);
                return s.render ? s.render(wert as never, p, i) : String(wert);
              },
            }
          : s,
      ),
  };
});

vi.mock('./lagekarte/Kartenflaeche', () => ({ default: () => null }));

class StummerKanal {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  close() {}
}

beforeEach(async () => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('BroadcastChannel', StummerKanal);
  setzeOnline(true);
  server.use(http.get('/api/einsaetze/:einsatzId/uhs', () => HttpResponse.json([])));
  await queueLeerenFuerTests();
});
afterEach(() => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  vi.unstubAllGlobals();
});

const P = (id: number): Person => ({
  id,
  einsatz_id: 1,
  registrier_nr: id,
  status: 'erfasst',
  name: `Name${id}`,
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
});

describe('PersonenPage rendert gemerkt (LFH-949)', () => {
  it('eine geänderte Person rendert nur ihre Zeile', async () => {
    setzeViewportBreite(1440);
    const zehn = Array.from({ length: 10 }, (_, i) => P(i + 1));
    server.use(
      meHandler(benutzerFixture()),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzFixture())),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json(zehn)),
      http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    );
    const { client } = renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
      </Routes>,
      { route: '/einsaetze/1/personen' },
    );
    await screen.findByText(/Name10/);
    gezeichnet.mockClear();
    act(() => {
      client.setQueryData(
        einsatzKeys.personen(1),
        zehn.map((p) => (p.id === 4 ? { ...p, antreff_ort: 'Fähre' } : p)),
      );
    });
    expect(await screen.findByText(/Fähre/)).toBeInTheDocument();
    expect(new Set(gezeichnet.mock.calls.map(([id]) => id))).toEqual(new Set([4]));
  });
});
