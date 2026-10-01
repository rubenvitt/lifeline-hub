/**
 * Die Warnquelle am Draht (LFH-397, design.md D3). `aktiveWarnung.test.ts` belegt die
 * Regel; diese Datei, dass der Hook die zwei Merkmale tatsächlich aus den Abrufen liest —
 * und das Gefahrenmodul ohne Freigabe gar nicht erst abfragt (403-Rauschen, Seitenkanal).
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import type { ModulFreigaben, Warnstufe } from '../api/types';
import { useAktiveWarnung } from './useAktiveWarnung';

const GEBIETE = '/api/einsaetze/7/gefahrengebiete';
const ZAEHLER = '/api/einsaetze/7/modul-zaehler';

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
  { freigaben }: { freigaben: ModulFreigaben | undefined } = { freigaben: freigabenFixture() },
) {
  return renderHook(() => useAktiveWarnung({ einsatzId: 7, freigaben }), {
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

  it('Freigaben unbekannt (laden noch/gescheitert) → das Gefahrenmodul wird nicht abgefragt', async () => {
    const abrufe = gebiete('akut');
    const { result } = starte({ freigaben: undefined });
    await takt();
    expect(abrufe.anzahl).toBe(0);
    expect(result.current).toBe(false);
  });
});
