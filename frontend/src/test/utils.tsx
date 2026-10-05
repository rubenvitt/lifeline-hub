import { QueryClientProvider, onlineManager, type QueryClient } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { App as AntApp, ConfigProvider } from 'antd';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router';
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { AuthProvider } from '../auth/AuthContext';
import { erzeugeQueryClient } from '../api/queryClient';

/**
 * Netz an oder aus wie im Browser: `navigator.onLine` UND TanStacks `onlineManager`, den ein
 * Browser über das Fensterereignis `online`/`offline` nachführt. Nur `navigator.onLine` zu
 * setzen, ließ eine von TanStack angehaltene Mutation unbemerkt (LFH-705, design.md D6).
 */
export function setzeOnline(wert: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: wert });
  onlineManager.setOnline(wert);
  window.dispatchEvent(new Event(wert ? 'online' : 'offline'));
}

/**
 * Frischer QueryClient ohne Retries/Cache-Wiederverwendung. Dieselbe Fabrik wie `main.tsx`,
 * damit der globale 401-Seam in Tests wie in Produktion wirkt.
 */
export function neuerQueryClient(): QueryClient {
  return erzeugeQueryClient({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  });
}

interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  client?: QueryClient;
  /**
   * Data Router statt `MemoryRouter` — Pflicht für alles, was `useBlocker` nutzt (Verlassen-Schutz
   * der Formularseiten, `frontend/AGENTS.md` „Formularseiten“): `useBlocker` wirft ohne ihn.
   */
  datenRouter?: boolean;
}

/**
 * Trägt die Kinder in den Data Router. Der Router entsteht EINMAL je Render; die einzige Route
 * liest die Kinder aus dem Kontext, damit `rerender` mit neuem Element ankommt.
 */
const KinderKontext = createContext<ReactNode>(null);
function KinderAusKontext() {
  return <>{useContext(KinderKontext)}</>;
}
function DatenRouter({ route, children }: { route: string; children: ReactNode }) {
  const [router] = useState(() =>
    createMemoryRouter([{ path: '*', element: <KinderAusKontext /> }], {
      initialEntries: [route],
    }),
  );
  return (
    <KinderKontext.Provider value={children}>
      <RouterProvider router={router} />
    </KinderKontext.Provider>
  );
}

/** Rendert eine Komponente mit Query-, antd- und Router-Providern. */
export function renderMitProviders(ui: ReactElement, options: ProviderOptions = {}) {
  const { datenRouter = false, ...renderOptionen } = options;
  const client = options.client ?? neuerQueryClient();
  const route = options.route ?? '/';
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ConfigProvider>
          <AntApp>
            {/* AuthProvider, weil die Einsatz-Seiten den Benutzer über `useAuth` lesen. Default-
               `/api/auth/me` (401 → anonym) liegt im MSW-Server; einen konkreten Benutzer setzt
               `server.use()`. */}
            <AuthProvider>
              {datenRouter ? (
                <DatenRouter route={route}>{children}</DatenRouter>
              ) : (
                <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
              )}
            </AuthProvider>
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>
    );
  }
  return { client, ...render(ui, { wrapper: Wrapper, ...renderOptionen }) };
}
