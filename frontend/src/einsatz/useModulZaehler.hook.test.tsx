import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModulOverrides } from '../api/types';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useModulZaehler } from './useModulZaehler';
import { benutzerFixture } from '../test/fixtures';

const benutzer = benutzerFixture({ anzeigename: 'E' });

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
          dokumente: { gesamt: 2 },
        }),
      ),
    );
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, benutzer }), { wrapper });
    await waitFor(() =>
      expect(result.current.personen).toEqual({ wert: 248, beschreibung: '248 Betroffene' }),
    );
    expect(result.current.dokumente).toEqual({ wert: 2, beschreibung: '2 abgelegte Dokumente' });
    expect(result.current.meldungen?.beschreibung).toBe('3 offene Meldungen, davon 1 ungesehen');
    // Ein fehlendes Feld bleibt fehlend — keine erfundene 0.
    expect(result.current.auftraege).toBeUndefined();
    // Genau die eine Zählabfrage für die Serverquellen, nie die Listen — auch nicht die
    // Dokumentliste (LFH-666). Dazu kommen nur die zwei Browser-Zähler, die ihre eigene
    // Modulliste lesen und nicht in der Serverantwort stehen. Das Wetter fragt erst nach
    // geladenen Overrides (LFH-663, hier fehlen sie).
    await waitFor(() => expect(angefragt).toHaveLength(3));
    expect([...angefragt].sort()).toEqual([
      '/api/einsaetze/7/abloesungen',
      '/api/einsaetze/7/betreuung',
      '/api/einsaetze/7/modul-zaehler',
    ]);
  });

  it('zeigt keinen Zähler an einem Modul, das der Rahmen ausblendet', async () => {
    server.use(
      http.get('/api/einsaetze/7/modul-zaehler', () =>
        HttpResponse.json({ personen: { gesamt: 248 }, meldungen: { offen: 3, ungesehen: 1 } }),
      ),
    );
    const overrides: ModulOverrides = {
      meldungen: {
        einsatz_id: 7,
        modul_key: 'meldungen',
        sichtbar: false,
        benoetigte_rolle: null,
        geaendert_at: null,
        geaendert_von: null,
      },
    };
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, benutzer, overrides }), {
      wrapper,
    });
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
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, benutzer }), { wrapper });
    // Erst NACH der Antwort prüfen — vorher wäre `{}` auch ohne Fehlerpfad das Ergebnis.
    await waitFor(() => expect(beantwortet).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual({});
  });
});
