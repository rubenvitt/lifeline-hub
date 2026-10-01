import { QueryClientProvider, onlineManager, type QueryClient } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { App as AntApp, ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router';
import type { ReactElement, ReactNode } from 'react';
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
}

/** Rendert eine Komponente mit Query-, antd- und Router-Providern. */
export function renderMitProviders(ui: ReactElement, options: ProviderOptions = {}) {
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
              <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
            </AuthProvider>
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>
    );
  }
  return { client, ...render(ui, { wrapper: Wrapper, ...options }) };
}
