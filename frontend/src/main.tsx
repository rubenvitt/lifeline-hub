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
import { createBrowserRouter, RouterProvider } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { appRouten } from './App';
import { ThemeModeProvider } from './theme/ThemeModeProvider';
import { erzeugeQueryClient } from './api/queryClient';
import { meldeAppAktualisierungVerfuegbar, setzeAppAktualisierer } from './pwa/appAktualisierung';

dayjs.extend(utc);

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: meldeAppAktualisierungVerfuegbar,
});
setzeAppAktualisierer(updateSW);

const queryClient = erzeugeQueryClient();
const router = createBrowserRouter(appRouten);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <AntApp notification={{ maxCount: 3 }}>
          <RouterProvider router={router} />
        </AntApp>
      </ThemeModeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>,
);
