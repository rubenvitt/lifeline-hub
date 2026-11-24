import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import BefehlDetailPage from './BefehlDetailPage';
import { AuthProvider } from '../auth/AuthContext';
import * as befehleApi from '../api/befehle';
import * as einsaetzeApi from '../api/einsaetze';

/**
 * LFH-627: „Instance created by `useForm` is not connected to any Form element". Ein
 * freigegebener Befehl rendert kein `<Form>`, der Verlustschutz schrieb den Serverstand trotzdem
 * per `setFieldsValue` hinein.
 *
 * **Eigene Datei, und das ist Absicht:** `@rc-component/util` gibt dieselbe Warnung je
 * Modulinstanz nur EINMAL aus (`warningOnce`). In `BefehlDetailPage.test.tsx` hätte ein früherer
 * Test sie schon verbraucht, und dieser bliebe auch mit dem Fehler grün. Vitest isoliert die
 * Module je Testdatei.
 */

vi.mock('../api/befehle');
vi.mock('../api/einsaetze');

const einsatz = { id: 1, bezeichnung: 'Übung', status: 'aktiv', meine_rolle: 'einsatzleitung' };

const freigegeben = {
  id: 7,
  einsatz_id: 1,
  vorlage: 'befehl_ladef',
  titel: 'Befehl 1',
  zeitstand: '2026-06-02 10:00:00',
  status: 'freigegeben',
  abschnitte: [],
  version: 1,
  vorgaenger_id: null,
  ersteller_id: 1,
  ersteller_name: 'EL',
  erstellt_at: '',
  aktualisiert_at: '',
  freigegeben_von_id: null,
  freigegeben_von_name: null,
  freigegeben_at: null,
  etb_eintrag_id: 5,
};

/** Die Prüfung von rc-field-form läuft in einem `setTimeout(…, 0)` nach dem Aufruf. */
const naechsterMakrotask = () => new Promise((r) => setTimeout(r, 0));

function unverbundenWarnungen(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('is not connected'));
}

afterEach(() => vi.restoreAllMocks());

describe('BefehlDetailPage · Formularbindung (LFH-627)', () => {
  it('ein freigegebener Befehl fasst das Formular des Verlustschutzes nicht an', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue(einsatz as never);
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(freigegeben as never);
    const spy = vi.spyOn(console, 'error');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(
      [{ path: '/einsaetze/:id/auftraege/befehle/:befehlId', element: <BefehlDetailPage /> }],
      { initialEntries: ['/einsaetze/1/auftraege/befehle/7'] },
    );
    render(
      <QueryClientProvider client={qc}>
        <AntApp>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </AntApp>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Fortschreiben' })).toBeInTheDocument();
    await naechsterMakrotask();
    expect(unverbundenWarnungen(spy)).toEqual([]);
  });
});
