import { render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { registerSW } from 'virtual:pwa-register';
import { appRouten } from '../App';
import { neuerQueryClient } from '../test/utils';
import { meHandler, server } from '../test/server';
import { adminFixture } from '../test/fixtures';
import { setzeViewportBreite } from '../test/viewport';
import { merkeRouten } from '../rueckmeldung/adresse';
import { CLIENT_FEHLER_PFAD } from '../api/clientFehler';
import { FEHLERGRENZE_TITEL } from '../components/Fehlergrenze';
import { PUSH_SCHALTER } from '../pages/BenachrichtigungenPage';
import { ladePushStand, pushAbgleichen, schliessePushMeldungen } from '../alarm/webPush';
import { desktopPermission, schliesseAlleDesktopAlarme } from '../alarm/desktopAlarm';
import { beendeHuelle, starteIosHuelle } from '../test/huelle';

/**
 * Start in der iOS-Hülle (Change t39ltxxi, design.md Fakt 1): im WKWebView einer App gibt es keinen
 * Service Worker. Registrierung, Alarm und Web Push bleiben dann still — kein Wurf, keine
 * unbehandelte Zurückweisung, kein Bericht an `/api/client-fehler`.
 */

const admin = adminFixture();
const einsatz = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  stichwort: null,
  status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
};

beforeAll(() => merkeRouten(appRouten));
afterAll(() => merkeRouten([]));

afterEach(() => {
  beendeHuelle();
  schliesseAlleDesktopAlarme();
  vi.restoreAllMocks();
});

function mitIosHuelleOhneServiceWorker() {
  expect('serviceWorker' in navigator).toBe(false);
  starteIosHuelle({ bruecke: { postMessage: vi.fn() } });
  const berichte: unknown[] = [];
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.post(CLIENT_FEHLER_PFAD, async ({ request }) => {
      berichte.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const unbehandelt = vi.fn();
  process.on('unhandledRejection', unbehandelt);
  return {
    berichte,
    unbehandelt,
    ende: () => process.off('unhandledRejection', unbehandelt),
  };
}

describe('Start in der iOS-Hülle ohne Service Worker', () => {
  it('Registrierung, Alarm und Web Push bleiben still', async () => {
    const { unbehandelt, ende } = mitIosHuelleOhneServiceWorker();
    try {
      // Registrierung wie in `main.tsx`.
      expect(() => registerSW({ immediate: true, onNeedRefresh: vi.fn() })).not.toThrow();
      // Web Push: kein Schalter, das Abgleichen nach der Anmeldung und das Schließen tun nichts.
      await expect(ladePushStand()).resolves.toMatchObject({ zustand: 'fehlt' });
      await expect(pushAbgleichen(admin.id)).resolves.toBeUndefined();
      await expect(schliessePushMeldungen(41)).resolves.toBeUndefined();
      // Alarm: die Erlaubnis der Web-Notification fragt niemand ab, der Weg ohne Worker wirft nicht.
      expect(() => desktopPermission()).not.toThrow();
      await new Promise((fertig) => setTimeout(fertig, 0));
      expect(unbehandelt).not.toHaveBeenCalled();
    } finally {
      ende();
    }
  });

  it('der Einsatz öffnet ohne Fehlergrenze und ohne Bericht an den Server', async () => {
    setzeViewportBreite(1440);
    const { berichte, unbehandelt, ende } = mitIosHuelleOhneServiceWorker();
    try {
      const router = createMemoryRouter(appRouten, { initialEntries: ['/einsaetze/7'] });
      render(
        <StrictMode>
          <QueryClientProvider client={neuerQueryClient()}>
            <ConfigProvider>
              <AntApp>
                <RouterProvider router={router} />
              </AntApp>
            </ConfigProvider>
          </QueryClientProvider>
        </StrictMode>,
      );
      expect(await screen.findByRole('button', { name: /Hochwasser Nord/ })).toBeEnabled();
      await router.navigate('/benachrichtigungen');
      expect(await screen.findByRole('region', { name: 'Hinweise' })).toBeInTheDocument();
      await new Promise((fertig) => setTimeout(fertig, 50));
      expect(screen.queryByText(FEHLERGRENZE_TITEL)).not.toBeInTheDocument();
      expect(berichte).toEqual([]);
      expect(unbehandelt).not.toHaveBeenCalled();
      // Kein Push-Schalter in der App-Hülle.
      expect(screen.queryByRole('switch', { name: PUSH_SCHALTER })).not.toBeInTheDocument();
      await waitFor(() => expect(berichte).toEqual([]));
    } finally {
      ende();
    }
  });
});
