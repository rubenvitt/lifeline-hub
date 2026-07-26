// Reihenfolge zählt: erst die Schriftrollen, dann die Farb-/Formrollen, dann
// das globale CSS, das beide benutzt (LFH-352 · A0).
import './theme/schriften.css';
import './theme/rollen.css';
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp } from 'antd';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import App from './App';
import { ThemeModeProvider } from './theme/ThemeModeProvider';
import { AuthProvider } from './auth/AuthContext';
import { CommandPaletteProvider } from './command-palette/CommandPaletteProvider';
import { erzeugeQueryClient } from './api/queryClient';

dayjs.extend(utc);

registerSW({ immediate: true });

const queryClient = erzeugeQueryClient({ queries: { retry: false, staleTime: 10_000 } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <AntApp>
          <BrowserRouter>
            <AuthProvider>
              <CommandPaletteProvider>
                <App />
              </CommandPaletteProvider>
            </AuthProvider>
          </BrowserRouter>
        </AntApp>
      </ThemeModeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>,
);
