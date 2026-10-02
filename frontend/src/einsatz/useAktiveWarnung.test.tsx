/**
 * Die Warnquelle am Draht (LFH-397, design.md D3; LFH-774, D1–D4). `aktiveWarnung.test.ts`
 * belegt die Regel; diese Datei, dass der Hook die drei Merkmale tatsächlich aus den Abrufen
 * liest — und Gefahren- wie Wettermodul ohne Freigabe gar nicht erst abfragt (403-Rauschen,
 * Seitenkanal).
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { einsatzKeys } from '../api/queryKeys';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import type { ModulFreigaben, Warnstufe, WetterWarnstufe } from '../api/types';
import { useAktiveWarnung } from './useAktiveWarnung';
import { useModulZaehler } from './useModulZaehler';

const GEBIETE = '/api/einsaetze/7/gefahrengebiete';
const ZAEHLER = '/api/einsaetze/7/modul-zaehler';
const WETTER = '/api/einsaetze/7/wetter';

const STUNDE = 60 * 60_000;
const um = (ms: number) => new Date(Date.now() + ms).toISOString();

interface DwdWarnung {
  stufe: WetterWarnstufe;
  /** Versatz zu jetzt in ms. */
  beginn: number;
  ende: number;
}

/** Antwort von `/wetter`; `zustand` wie vom Server (Ausfall ist kein HTTP-Fehler). */
function wetterAntwort(warnungen: DwdWarnung[], zustand: 'ok' | 'ausfall' = 'ok') {
  return {
    warnungen: {
      zustand,
      abgerufen_at: um(-60_000),
      daten: warnungen.map((w) => ({
        stufe: w.stufe,
        ereignis: 'ORKANBÖEN',
        ueberschrift: 'Amtliche UNWETTERWARNUNG vor ORKANBÖEN',
        beginn: um(w.beginn),
        ende: um(w.ende),
      })),
    },
    vorhersage: { zustand: 'kein_ort' as const },
  };
}

/** Wetter am Einsatzort mit Abrufzähler. */
function wetter(warnungen: DwdWarnung[], zustand: 'ok' | 'ausfall' = 'ok') {
  const zaehler = { anzahl: 0 };
  server.use(
    http.get(WETTER, () => {
      zaehler.anzahl += 1;
      return HttpResponse.json(wetterAntwort(warnungen, zustand));
    }),
  );
  return zaehler;
}

function gebiete(...stufen: Warnstufe[]) {
  const zaehler = { anzahl: 0 };
  server.use(
    http.get(GEBIETE, () => {
      zaehler.anzahl += 1;
      return HttpResponse.json(
        stufen.map((s, i) => ({
          id: i + 1,
          einsatz_id: 7,
          hoechste_warnstufe: s,
          label: `Gebiet ${i + 1}`,
          zonen_ids: [],
        })),
      );
    }),
  );
  return zaehler;
}

function bestaetigungUeberfaellig(anzahl: number) {
  server.use(
    http.get(ZAEHLER, () =>
      HttpResponse.json({
        meldungen: { offen: anzahl, ungesehen: 0, bestaetigung_ueberfaellig: anzahl },
      }),
    ),
  );
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/**
 * Freigaben wie vom Server (LFH-669); `{ freigaben: undefined }` steht für „noch nicht
 * geladen/gescheitert“ — als Feld, weil ein Default-Parameter `undefined` verschluckte.
 */
function starte(
  {
    freigaben,
    freigabenGescheitert = false,
  }: { freigaben: ModulFreigaben | undefined; freigabenGescheitert?: boolean } = {
    freigaben: freigabenFixture(),
  },
) {
  return renderHook(() => useAktiveWarnung({ einsatzId: 7, freigaben, freigabenGescheitert }), {
    wrapper: wrapper(neuerQueryClient()),
  });
}

/** Wartet, bis beide Abrufe durch sind — ein vorzeitiges `false` belegte nichts. */
const takt = () => new Promise((r) => setTimeout(r, 30));

describe('useAktiveWarnung', () => {
  it('Gefahrengebiet „akut" → Warnung', async () => {
    gebiete('niedrig', 'akut');
    const { result } = starte();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('höchste Warnstufe „mittel" → keine Warnung', async () => {
    const abrufe = gebiete('mittel', 'keine');
    const { result } = starte();
    await waitFor(() => expect(abrufe.anzahl).toBe(1));
    await takt();
    expect(result.current).toBe(false);
  });

  it('überfällige Bestätigungspflicht → Warnung, auch ohne Gefahrengebiet', async () => {
    gebiete();
    bestaetigungUeberfaellig(1);
    const { result } = starte();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('Gefahrengebiete-Abruf scheitert → keine Warnung', async () => {
    let abrufe = 0;
    server.use(
      http.get(GEBIETE, () => {
        abrufe += 1;
        return HttpResponse.json({ error: 'kaputt' }, { status: 500 });
      }),
    );
    const { result } = starte();
    await waitFor(() => expect(abrufe).toBeGreaterThan(0));
    await takt();
    expect(result.current).toBe(false);
  });

  it('Gefahrenmodul ausgeblendet → keine Anfrage und keine Warnung, auch wenn ein Gebiet akut wäre', async () => {
    const abrufe = gebiete('akut');
    const { result } = starte({
      freigaben: freigabenFixture({ gefahrenzonen: { sichtbar: false, zugriff: false } }),
    });
    await takt();
    expect(abrufe.anzahl).toBe(0);
    expect(result.current).toBe(false);
  });

  it('Gefahrenmodul gesperrt (zugriff: false) → keine Anfrage und keine Warnung', async () => {
    const abrufe = gebiete('akut');
    const { result } = starte({
      freigaben: freigabenFixture({ gefahrenzonen: { zugriff: false } }),
    });
    await takt();
    expect(abrufe.anzahl).toBe(0);
    expect(result.current).toBe(false);
  });

  it('Freigaben laden noch → das Gefahrenmodul wird nicht abgefragt', async () => {
    const abrufe = gebiete('akut');
    const { result } = starte({ freigaben: undefined });
    await takt();
    expect(abrufe.anzahl).toBe(0);
    expect(result.current).toBe(false);
  });

  it('Freigaben gescheitert → keine Anfrage, aber die Sperre hält (fail-safe, LFH-669)', async () => {
    // Ohne Freigaben weiß niemand, ob ein Gebiet akut ist. Abgefragt wird trotzdem nicht (Spec
    // `modul-freigabe`); der Helligkeitsregler hält dafür den Warnboden.
    const abrufe = gebiete('akut');
    const { result } = starte({ freigaben: undefined, freigabenGescheitert: true });
    await takt();
    expect(abrufe.anzahl).toBe(0);
    expect(result.current).toBe(true);
  });

  describe('DWD-Unwetter (LFH-774)', () => {
    it('Unwetter „schwer" gilt jetzt → Warnung', async () => {
      wetter([{ stufe: 'schwer', beginn: -STUNDE, ende: STUNDE }]);
      const { result } = starte();
      await waitFor(() => expect(result.current).toBe(true));
    });

    it('nur markantes Wetter („maessig") → keine Warnung', async () => {
      const abrufe = wetter([{ stufe: 'maessig', beginn: -STUNDE, ende: STUNDE }]);
      const { result } = starte();
      await waitFor(() => expect(abrufe.anzahl).toBe(1));
      await takt();
      expect(result.current).toBe(false);
    });

    it('„extrem" erst angekündigt → keine Warnung', async () => {
      const abrufe = wetter([{ stufe: 'extrem', beginn: 2 * STUNDE, ende: 5 * STUNDE }]);
      const { result } = starte();
      await waitFor(() => expect(abrufe.anzahl).toBe(1));
      await takt();
      expect(result.current).toBe(false);
    });

    it('Wetterdienst ausgefallen → keine Warnung, auch wenn Daten mitkämen', async () => {
      const abrufe = wetter([{ stufe: 'extrem', beginn: -STUNDE, ende: STUNDE }], 'ausfall');
      const { result } = starte();
      await waitFor(() => expect(abrufe.anzahl).toBe(1));
      await takt();
      expect(result.current).toBe(false);
    });

    it('Wetterabruf scheitert → keine Warnung', async () => {
      let abrufe = 0;
      server.use(
        http.get(WETTER, () => {
          abrufe += 1;
          return HttpResponse.json({ error: 'kaputt' }, { status: 500 });
        }),
      );
      const { result } = starte();
      await waitFor(() => expect(abrufe).toBeGreaterThan(0));
      await takt();
      expect(result.current).toBe(false);
    });

    it('Wettermodul ausgeblendet → keine Anfrage und keine Warnung, auch bei Unwetter', async () => {
      const abrufe = wetter([{ stufe: 'extrem', beginn: -STUNDE, ende: STUNDE }]);
      const { result } = starte({
        freigaben: freigabenFixture({ 'wetter-pegel': { sichtbar: false, zugriff: false } }),
      });
      await takt();
      expect(abrufe.anzahl).toBe(0);
      expect(result.current).toBe(false);
    });

    it('Wettermodul gesperrt (zugriff: false) → keine Anfrage und keine Warnung', async () => {
      const abrufe = wetter([{ stufe: 'extrem', beginn: -STUNDE, ende: STUNDE }]);
      const { result } = starte({
        freigaben: freigabenFixture({ 'wetter-pegel': { zugriff: false } }),
      });
      await takt();
      expect(abrufe.anzahl).toBe(0);
      expect(result.current).toBe(false);
    });

    it('kein Zusatzabruf: Sperre und Modulzähler teilen EIN Cache-Fach (D1)', async () => {
      const abrufe = wetter([{ stufe: 'schwer', beginn: -STUNDE, ende: STUNDE }]);
      // Die übrigen Browser-Zähler aus: ihre Abrufe gehören nicht zu dieser Frage.
      const freigaben = freigabenFixture({
        abloesung: { sichtbar: false },
        betreuung: { sichtbar: false },
      });
      const { result } = renderHook(
        () => ({
          warnung: useAktiveWarnung({ einsatzId: 7, freigaben }),
          zaehler: useModulZaehler({ einsatzId: 7, freigaben }),
        }),
        { wrapper: wrapper(neuerQueryClient()) },
      );
      await waitFor(() => expect(result.current.warnung).toBe(true));
      await waitFor(() => expect(result.current.zaehler['wetter-pegel']).toBeDefined());
      await takt();
      expect(abrufe.anzahl).toBe(1);
    });

    it('Unwetter endet → die Warnung fällt ohne neuen Abruf weg', async () => {
      // Ende in 1 s: die Unwetter-Uhr weckt am Ende, nicht der 5-min-Abruf.
      const abrufe = wetter([{ stufe: 'schwer', beginn: -STUNDE, ende: 1000 }]);
      const { result } = starte();
      await waitFor(() => expect(result.current).toBe(true));
      await waitFor(() => expect(result.current).toBe(false), { timeout: 3000 });
      expect(abrufe.anzahl).toBe(1);
    });

    it('angekündigtes Unwetter beginnt → die Warnung greift ohne neuen Abruf', async () => {
      const abrufe = wetter([{ stufe: 'extrem', beginn: 1000, ende: STUNDE }]);
      const { result } = starte();
      await waitFor(() => expect(abrufe.anzahl).toBe(1));
      await takt();
      expect(result.current).toBe(false);
      await waitFor(() => expect(result.current).toBe(true), { timeout: 3000 });
      expect(abrufe.anzahl).toBe(1);
    });

    it('Folgeabruf scheitert → die alte Unwetterwarnung trägt nicht mehr bei', async () => {
      // Query behält die alten Daten neben dem Fehler; der Modulzähler zeigt dann nichts mehr
      // (`isSuccess`), also darf auch die Sperre nicht ohne sichtbaren Beleg weiter greifen.
      wetter([{ stufe: 'schwer', beginn: -STUNDE, ende: STUNDE }]);
      const client = neuerQueryClient();
      const freigaben = freigabenFixture();
      const { result } = renderHook(() => useAktiveWarnung({ einsatzId: 7, freigaben }), {
        wrapper: wrapper(client),
      });
      await waitFor(() => expect(result.current).toBe(true));
      server.use(http.get(WETTER, () => HttpResponse.json({ error: 'weg' }, { status: 500 })));
      await act(() => client.refetchQueries({ queryKey: einsatzKeys.wetter(7) }));
      await waitFor(() => expect(result.current).toBe(false));
    });

    it('Modul während der Sitzung ausgeblendet → ein noch gefüllter Cache zählt nicht', async () => {
      const client = neuerQueryClient();
      client.setQueryData(
        einsatzKeys.wetter(7),
        wetterAntwort([{ stufe: 'extrem', beginn: -STUNDE, ende: STUNDE }]),
      );
      const abrufe = wetter([{ stufe: 'extrem', beginn: -STUNDE, ende: STUNDE }]);
      const freigaben = freigabenFixture({ 'wetter-pegel': { sichtbar: false } });
      const { result } = renderHook(() => useAktiveWarnung({ einsatzId: 7, freigaben }), {
        wrapper: wrapper(client),
      });
      await takt();
      expect(client.getQueryData(einsatzKeys.wetter(7))).toBeDefined();
      expect(abrufe.anzahl).toBe(0);
      expect(result.current).toBe(false);
    });
  });
});
