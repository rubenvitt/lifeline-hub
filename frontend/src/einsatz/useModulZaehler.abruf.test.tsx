import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import type { ModulFreigaben } from '../api/types';
import { useModulZaehler } from './useModulZaehler';
import { freigabenFixture } from '../test/fixtures';

/**
 * Der Hook des Modulzählers am Draht (LFH-639). Der Test von `darfZaehlerZeigen` sieht NICHT,
 * ob die Entscheidung an der `useQuery` ankommt — fiele `enabled: betreuungAktiv` weg, fragte
 * die Navigation ein verstecktes Modul ab (403-Rauschen, Seitenkanal). Deshalb der
 * MSW-Anfragezähler als Paar: versteckt, gesperrt oder Freigaben unbekannt → 0 Anfragen,
 * sichtbar und frei → genau 1. Die Freigaben kommen vom Server (LFH-669).
 *
 * Die anderen Zählermodule sind ausgeblendet; `modul-zaehler` beantwortet der Vorgabe-Handler
 * aus `test/server.ts`.
 */

const PFAD = '/api/einsaetze/7/betreuung';

const ANDERE = ['meldungen', 'auftraege', 'erinnerungen', 'chat', 'dokumente', 'abloesung'];

function ausgeblendet(keys: readonly string[]): ModulFreigaben {
  return freigabenFixture(
    Object.fromEntries(keys.map((key) => [key, { sichtbar: false, zugriff: false }])),
  );
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function zaehleAbrufe(): { anzahl: number } {
  const zaehler = { anzahl: 0 };
  server.use(
    http.get(PFAD, () => {
      zaehler.anzahl += 1;
      return HttpResponse.json({
        bezirke: [
          {
            id: 1,
            einsatz_id: 7,
            bezeichnung: 'Uferstraße 12–40',
            plan_personen: 640,
            plan_erhebung: 'gezaehlt',
            raeumung: 'laeuft',
            angelegt_at: '2026-09-23 08:00:00',
          },
        ],
        stellen: [],
      });
    }),
  );
  return zaehler;
}

describe('useModulZaehler am Draht — Betreuung (LFH-639)', () => {
  it('Modul ausgeblendet → keine Anfrage an …/betreuung, kein Zähler', async () => {
    const abrufe = zaehleAbrufe();
    const { result } = renderHook(
      () =>
        useModulZaehler({
          einsatzId: 7,
          freigaben: ausgeblendet([...ANDERE, 'betreuung']),
        }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    // Wie im Kennzahl-Hook: einen Takt warten, damit ein fälschlich aktiver Abruf ankäme.
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current.betreuung).toBeUndefined();
  });

  it('Modul sichtbar → genau eine Anfrage, Zähler der aktiven Bezirke', async () => {
    const abrufe = zaehleAbrufe();
    const { result } = renderHook(
      () => useModulZaehler({ einsatzId: 7, freigaben: ausgeblendet(ANDERE) }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    await waitFor(() => expect(result.current.betreuung).toBeDefined());
    expect(result.current.betreuung).toEqual({
      wert: 1,
      beschreibung: '1 aktiver Evakuierungsbezirk',
    });
    expect(abrufe.anzahl).toBe(1);
  });

  it('Modul gesperrt (zugriff: false) → keine Anfrage an …/betreuung, kein Zähler', async () => {
    const abrufe = zaehleAbrufe();
    const gesperrt = { ...ausgeblendet(ANDERE), betreuung: { sichtbar: true, zugriff: false } };
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, freigaben: gesperrt }), {
      wrapper: wrapper(neuerQueryClient()),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current.betreuung).toBeUndefined();
  });

  it('Freigaben unbekannt (laden noch/gescheitert) → keine Anfrage an …/betreuung', async () => {
    const abrufe = zaehleAbrufe();
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, freigaben: undefined }), {
      wrapper: wrapper(neuerQueryClient()),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current.betreuung).toBeUndefined();
  });
});

describe('useModulZaehler am Draht — Wetter & Pegel (LFH-663)', () => {
  const WETTER = '/api/einsaetze/7/wetter';
  const JETZT = Date.now();
  const um = (ms: number) => new Date(JETZT + ms).toISOString();
  const ALLE_ANDEREN = [...ANDERE, 'betreuung'];

  function zaehleWetterAbrufe(): { anzahl: number } {
    const zaehler = { anzahl: 0 };
    server.use(
      http.get(WETTER, () => {
        zaehler.anzahl += 1;
        return HttpResponse.json({
          ort: { name: 'Hann. Münden' },
          warnungen: {
            zustand: 'ok',
            abgerufen_at: um(-60_000),
            daten: [
              {
                stufe: 'schwer',
                ereignis: 'SCHWERES GEWITTER',
                ueberschrift: 'Amtliche UNWETTERWARNUNG vor SCHWEREM GEWITTER',
                beginn: um(-3_600_000),
                ende: um(3_600_000),
              },
              {
                stufe: 'maessig',
                ereignis: 'STURMBÖEN',
                ueberschrift: 'Amtliche WARNUNG vor STURMBÖEN',
                beginn: um(-3_600_000),
                ende: um(3_600_000),
              },
            ],
          },
          vorhersage: { zustand: 'ausfall' },
        });
      }),
    );
    return zaehler;
  }

  it('Modul ausgeblendet → keine Anfrage an …/wetter, kein Zähler', async () => {
    const abrufe = zaehleWetterAbrufe();
    const { result } = renderHook(
      () =>
        useModulZaehler({
          einsatzId: 7,
          freigaben: ausgeblendet([...ALLE_ANDEREN, 'wetter-pegel']),
        }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current['wetter-pegel']).toBeUndefined();
  });

  it('Modul sichtbar → genau eine Anfrage, Zahl der Unwetterwarnungen ohne „mäßig"', async () => {
    const abrufe = zaehleWetterAbrufe();
    const { result } = renderHook(
      () => useModulZaehler({ einsatzId: 7, freigaben: ausgeblendet(ALLE_ANDEREN) }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    await waitFor(() => expect(result.current['wetter-pegel']).toBeDefined());
    expect(result.current['wetter-pegel']).toEqual({
      wert: 1,
      beschreibung: '1 Unwetterwarnung für den Einsatzort',
    });
    expect(abrufe.anzahl).toBe(1);
  });

  it('solange die Freigaben laden → keine Anfrage an …/wetter (kein 403 bei ausgeblendetem Modul)', async () => {
    const abrufe = zaehleWetterAbrufe();
    renderHook(() => useModulZaehler({ einsatzId: 7, freigaben: undefined }), {
      wrapper: wrapper(neuerQueryClient()),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
  });
});
