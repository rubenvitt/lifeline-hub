import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import TierePage from './TierePage';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

/**
 * LFH-627: „Instance created by `useForm` is not connected to any Form element". Wie im
 * Schadendialog fassten zwei Wege die Formularinstanz an, ohne dass ein `<Form>` hing:
 *  - `?neu=1` öffnet den Dialog über den echten Scheduler; der Öffnen-Effekt setzte den gemerkten
 *    Antreffort, bevor antds `Modal` sein `<Form>` eingehängt hatte;
 *  - der Einsatzwechsel rief `resetFields()`, auch wenn der Dialog nie offen war.
 *
 * **Eigene Datei, und das ist Absicht:** `@rc-component/util` gibt dieselbe Warnung je
 * Modulinstanz nur EINMAL aus (`warningOnce`). Vitest isoliert die Module je Testdatei; die
 * beiden Fälle unten belegen sich je mit `-t` einzeln.
 */

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const nutzer = benutzerFixture();
const einsatzAktiv = einsatzFixture();

/** Die Prüfung von rc-field-form läuft in einem `setTimeout(…, 0)` nach dem Aufruf. */
const naechsterMakrotask = () => new Promise((r) => setTimeout(r, 0));

function unverbundenWarnungen(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('is not connected'));
}

function EinsatzWechsel() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/einsaetze/2/tiere')}>Zu Einsatz B</button>;
}

function render(route: string) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/:einsatzId', ({ params }) =>
      HttpResponse.json({ ...einsatzAktiv, id: Number(params.einsatzId) }),
    ),
    http.get('/api/einsaetze/:einsatzId/tiere', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/tiere"
        element={
          <>
            <EinsatzWechsel />
            <TierePage />
          </>
        }
      />
    </Routes>,
    { route },
  );
}

describe('TierePage · Formularbindung (LFH-627)', () => {
  it('?neu=1 setzt den gemerkten Antreffort erst, wenn das Formular eingehängt ist', async () => {
    sessionStorage.setItem('lfh:erfassung:1:tier:antreff_ort', 'Tierlager A');
    const spy = vi.spyOn(console, 'error');
    render('/einsaetze/1/tiere?neu=1');

    await waitFor(() => expect(screen.getByLabelText('Antreffort')).toHaveValue('Tierlager A'));
    await act(naechsterMakrotask);
    expect(unverbundenWarnungen(spy)).toEqual([]);
  });

  it('ein Einsatzwechsel bei nie geöffnetem Dialog fasst das Formular nicht an', async () => {
    const spy = vi.spyOn(console, 'error');
    render('/einsaetze/1/tiere');

    await userEvent.click(await screen.findByRole('button', { name: 'Zu Einsatz B' }));
    await screen.findByRole('button', { name: 'Schnellerfassung' });
    await act(naechsterMakrotask);

    expect(unverbundenWarnungen(spy)).toEqual([]);
  });
});
