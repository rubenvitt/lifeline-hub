import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { App as AntApp, ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider } from '../auth/AuthContext';
import { erzeugeQueryClient } from '../api/queryClient';

/** Frischer QueryClient ohne Retries/Cache-Wiederverwendung — deterministische Tests.
 *  Nutzt bewusst dieselbe Fabrik wie `main.tsx`, damit der globale 401-Seam (LFH-268)
 *  in Tests dieselbe Wirkung hat wie in Produktion. */
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
            {/* AuthProvider hier, seit die Einsatz-Seiten via schreibrecht.ts/useAuth den
                Benutzer lesen (LFH-234, admin-global). Default-`/api/auth/me` (401 → benutzer=null)
                liegt im MSW-Server; Tests, die einen konkreten Benutzer brauchen, setzen ihn per
                server.use(). */}
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
