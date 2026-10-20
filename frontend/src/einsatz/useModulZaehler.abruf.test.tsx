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
 * ob die Entscheidung an der `useQuery` ankommt — fiele `enabled: evakuierungAktiv` weg, fragte
 * die Navigation ein verstecktes Modul ab (403-Rauschen, Seitenkanal). Deshalb der
 * MSW-Anfragezähler als Paar: versteckt, gesperrt oder Freigaben unbekannt → 0 Anfragen,
 * sichtbar und frei → genau 1. Die Freigaben kommen vom Server (LFH-669).
 *
 * Die anderen Zählermodule sind ausgeblendet; `modul-zaehler` beantwortet der Vorgabe-Handler
 * aus `test/server.ts`.
 */

const PFAD_EVAK = '/api/einsaetze/7/evakuierung';
const PFAD_BETREUUNG = '/api/einsaetze/7/betreuung';

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

function zaehleAbrufe(pfad: string, antwort: object): { anzahl: number } {
  const zaehler = { anzahl: 0 };
  server.use(
    http.get(pfad, () => {
      zaehler.anzahl += 1;
      return HttpResponse.json(antwort);
    }),
  );
  return zaehler;
}

const EVAKUIERUNG = {
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
};

const BETREUUNG = {
  stellen: [
    {
      id: 3,
      einsatz_id: 7,
      bezeichnung: 'Turnhalle Ost',
      art: 'notunterkunft',
      status: 'in_betrieb',
      angelegt_at: '2026-09-23 08:00:00',
    },
    {
      id: 4,
      einsatz_id: 7,
      bezeichnung: 'Schule Nord',
      art: 'notunterkunft',
      status: 'vorbereitet',
      angelegt_at: '2026-09-23 08:00:00',
    },
  ],
};

// Je Modul dieselben vier Fälle: ausgeblendet, sichtbar, gesperrt, Freigaben unbekannt. Das
// jeweils andere der beiden Module ist ausgeblendet (LLH-1034: zwei getrennte Abrufe).
describe.each([
  {
    modul: 'evakuierung' as const,
    anderes: 'betreuung',
    pfad: PFAD_EVAK,
    antwort: EVAKUIERUNG,
    erwartet: { wert: 1, beschreibung: '1 aktiver Evakuierungsbezirk' },
  },
  {
    modul: 'betreuung' as const,
    anderes: 'evakuierung',
    pfad: PFAD_BETREUUNG,
    antwort: BETREUUNG,
    erwartet: { wert: 1, beschreibung: '1 Betreuungsstelle in Betrieb' },
  },
])('useModulZaehler am Draht — $modul (LFH-639, LLH-1034)', ({ modul, anderes, pfad, antwort, erwartet }) => {
  it('Modul ausgeblendet → keine Anfrage, kein Zähler', async () => {
    const abrufe = zaehleAbrufe(pfad, antwort);
    const { result } = renderHook(
      () =>
        useModulZaehler({
          einsatzId: 7,
          freigaben: ausgeblendet([...ANDERE, anderes, modul]),
        }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    // Wie im Kennzahl-Hook: einen Takt warten, damit ein fälschlich aktiver Abruf ankäme.
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current[modul]).toBeUndefined();
  });

  it('Modul sichtbar → genau eine Anfrage, Zähler', async () => {
    const abrufe = zaehleAbrufe(pfad, antwort);
    const { result } = renderHook(
      () => useModulZaehler({ einsatzId: 7, freigaben: ausgeblendet([...ANDERE, anderes]) }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    await waitFor(() => expect(result.current[modul]).toBeDefined());
    expect(result.current[modul]).toEqual(erwartet);
    expect(abrufe.anzahl).toBe(1);
  });

  it('Modul gesperrt (zugriff: false) → keine Anfrage, kein Zähler', async () => {
    const abrufe = zaehleAbrufe(pfad, antwort);
    const gesperrt = {
      ...ausgeblendet([...ANDERE, anderes]),
      [modul]: { sichtbar: true, zugriff: false },
    };
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, freigaben: gesperrt }), {
      wrapper: wrapper(neuerQueryClient()),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current[modul]).toBeUndefined();
  });

  it('Freigaben unbekannt (laden noch/gescheitert) → keine Anfrage', async () => {
    const abrufe = zaehleAbrufe(pfad, antwort);
    const { result } = renderHook(() => useModulZaehler({ einsatzId: 7, freigaben: undefined }), {
      wrapper: wrapper(neuerQueryClient()),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current[modul]).toBeUndefined();
  });
});

describe('useModulZaehler am Draht — Wetter & Pegel (LFH-663)', () => {
  const WETTER = '/api/einsaetze/7/wetter';
  const JETZT = Date.now();
  const um = (ms: number) => new Date(JETZT + ms).toISOString();
  const ALLE_ANDEREN = [...ANDERE, 'betreuung', 'evakuierung'];

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
