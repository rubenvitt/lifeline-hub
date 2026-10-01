import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useModulZaehler } from './useModulZaehler';
import { freigabenFixture } from '../test/fixtures';

const freigaben = freigabenFixture();

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={neuerQueryClient()}>{children}</QueryClientProvider>;
}

const angefragt: string[] = [];
const merke = ({ request }: { request: Request }) => {
  angefragt.push(new URL(request.url).pathname);
};
afterEach(() => {
  server.events.removeListener('request:start', merke);
  angefragt.length = 0;
});

describe('useModulZaehler (LFH-612)', () => {
  it('liest EINE Zählantwort und lädt keine Listen der Servermodule', async () => {
    server.events.on('request:start', merke);
    server.use(
      http.get('/api/einsaetze/7/modul-zaehler', () =>
        HttpResponse.json({
          personen: { gesamt: 248 },
          meldungen: { offen: 3, ungesehen: 1 },
          chat: { ungelesen: 0 },
        }),
      ),
    );
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, freigaben }), { wrapper });
    await waitFor(() =>
      expect(result.current.personen).toEqual({ wert: 248, beschreibung: '248 Betroffene' }),
    );
    expect(result.current.meldungen?.beschreibung).toBe('3 offene Meldungen, davon 1 ungesehen');
    // Ein fehlendes Feld bleibt fehlend — keine erfundene 0.
    expect(result.current.auftraege).toBeUndefined();
    // Genau die eine Zählabfrage für die Serverquellen, nie die Listen. Dazu kommen nur die drei
    // Browser-Zähler, die ihre eigene Modulliste lesen und nicht in der Serverantwort stehen.
    await waitFor(() => expect(angefragt).toHaveLength(4));
    expect([...angefragt].sort()).toEqual([
      '/api/einsaetze/7/abloesungen',
      '/api/einsaetze/7/betreuung',
      '/api/einsaetze/7/dokumente',
      '/api/einsaetze/7/modul-zaehler',
    ]);
  });

  it('zeigt keinen Zähler an einem Modul, das der Rahmen ausblendet', async () => {
    server.use(
      http.get('/api/einsaetze/7/modul-zaehler', () =>
        HttpResponse.json({ personen: { gesamt: 248 }, meldungen: { offen: 3, ungesehen: 1 } }),
      ),
    );
    const ausgeblendet = freigabenFixture({ meldungen: { sichtbar: false, zugriff: false } });
    const { result } = renderHook(
      () => useModulZaehler({ einsatzId: 7, freigaben: ausgeblendet }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.personen?.wert).toBe(248));
    expect(result.current.meldungen).toBeUndefined();
  });

  it('zeigt ohne Antwort keine Zahl', async () => {
    let beantwortet = false;
    server.use(
      http.get('/api/einsaetze/7/modul-zaehler', () => {
        beantwortet = true;
        return HttpResponse.json({ error: 'kaputt' }, { status: 500 });
      }),
    );
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, freigaben }), { wrapper });
    // Erst NACH der Antwort prüfen — vorher wäre `{}` auch ohne Fehlerpfad das Ergebnis.
    await waitFor(() => expect(beantwortet).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual({});
  });

  /**
   * Unbekannte Freigaben (laden noch oder Abruf gescheitert) geben nichts frei (LFH-669): die
   * Browser-Zähler lesen fremde Modullisten und laden dann nicht — kein 403-Rauschen, kein
   * Seitenkanal. Die Serverantwort filtert der Server selbst; ihre Anzeige wartet ebenfalls.
   */
  it('lädt bei unbekannten Freigaben keine Browser-Zähler und zeigt keine Zahl', async () => {
    server.events.on('request:start', merke);
    let beantwortet = false;
    server.use(
      http.get('/api/einsaetze/7/modul-zaehler', () => {
        beantwortet = true;
        return HttpResponse.json({ personen: { gesamt: 248 } });
      }),
    );
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, freigaben: undefined }), {
      wrapper,
    });
    await waitFor(() => expect(beantwortet).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(angefragt).toEqual(['/api/einsaetze/7/modul-zaehler']);
    expect(result.current).toEqual({});
  });
});
