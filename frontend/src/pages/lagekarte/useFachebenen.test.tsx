import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { neuerQueryClient } from '../../test/utils';
import type { FachebeneAntwort, FachebeneQuelle, FeatureCollection } from '../../api/fachebenen';
import { useFachebenen } from './useFachebenen';
import { defaultFachebenenSichtbar, type FachebenenSichtbar } from './fachebenenAuswahl';

// Fixtures via vi.hoisted, damit sowohl die (hochgezogene) vi.mock-Factory als auch
// die Assertions dieselben Feature-Sammlungen sehen.
const fx = vi.hoisted(() => {
  const fc = (coords: number[][]): FeatureCollection => ({
    type: 'FeatureCollection',
    features: coords.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: {},
    })),
  });
  return { fc, nina: fc([[9, 50]]), kritisA: fc([[10, 51]]), kritisB: fc([[11, 52]]) };
});

vi.mock('../../api/fachebenen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/fachebenen')>();
  return {
    ...actual,
    ladeFachebene: vi.fn((quelle: FachebeneQuelle, bbox?: string): Promise<FachebeneAntwort> => {
      if (quelle === 'nina')
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution: '© NINA',
          stand: null,
          features: fx.nina,
        });
      if (quelle === 'kritis')
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution: '© KRITIS',
          stand: null,
          features: bbox === 'bbox2' ? fx.kritisB : fx.kritisA,
        });
      return Promise.resolve({
        quelle,
        status: 'leer',
        attribution: '',
        stand: null,
        features: fx.fc([]),
      });
    }),
  };
});

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// Sichtbarkeit ist seit LFH-319 externer State (useKartenAnsicht); im Test hält ihn ein
// kontrollierter useState, damit onFachebeneToggle → setFachebenenSichtbar den Hook re-rendert.
function rendere() {
  return renderHook(
    () => {
      const [sichtbar, setSichtbar] = useState<FachebenenSichtbar>(defaultFachebenenSichtbar);
      return useFachebenen({ fachebenenSichtbar: sichtbar, setFachebenenSichtbar: setSichtbar });
    },
    { wrapper: wrapper() },
  );
}

describe('useFachebenen', () => {
  it('startet mit allen Ebenen aus (keine Queries, keine Attribution)', () => {
    const { result } = rendere();
    expect(result.current.aktiveFachebenen).toHaveLength(0);
    expect(result.current.fachebenenAttribution).toHaveLength(0);
  });

  it('aktiviert nina → Layer-Daten, Status und Attribution aus der Query', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('nina', true));
    // Auf die geladenen Daten warten, nicht bloß auf die Sichtbarkeit (sonst Race: der
    // Layer erscheint mit leerer FeatureCollection, bevor die Query aufgelöst ist).
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'nina')?.daten.features,
      ).toHaveLength(1),
    );
    const nina = result.current.aktiveFachebenen.find((f) => f.def.key === 'nina');
    expect(nina?.daten.features).toHaveLength(1);
    expect(result.current.fachebenenStatus.nina).toBe('ok');
    expect(result.current.fachebenenAttribution).toContain('© NINA');
  });

  it('akkumuliert KRITIS über einen bbox-Wechsel (ersetzt nicht)', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('kritis', true));
    act(() => result.current.setKritisBbox('bbox1'));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'kritis')?.daten.features,
      ).toHaveLength(1),
    );
    act(() => result.current.setKritisBbox('bbox2'));
    // Beide Objekte bleiben sichtbar (mergeFeatures akkumuliert), nicht nur das neue.
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'kritis')?.daten.features,
      ).toHaveLength(2),
    );
  });

  it('hält die aktiveFachebenen-Referenz über ein No-op-Re-Render stabil (combine-Memoisierung)', async () => {
    const { result, rerender } = rendere();
    act(() => result.current.onFachebeneToggle('nina', true));
    // Erst wenn die Daten geladen sind (kein Pending mehr), ist die combine-Ausgabe stabil.
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'nina')?.daten.features,
      ).toHaveLength(1),
    );
    const vorher = result.current.aktiveFachebenen;
    rerender();
    // replaceEqualDeep in query-core → identische Referenz bei unveränderten Daten,
    // sonst würde der Kartenflaeche-fachebenen-Effekt pro Frame neu feuern.
    expect(result.current.aktiveFachebenen).toBe(vorher);
  });

  it('meldet kritisZoomZuKlein unterhalb des Mindest-Zooms', () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('kritis', true));
    act(() => result.current.setKartenZoom(5));
    expect(result.current.kritisZoomZuKlein).toBe(true);
    act(() => result.current.setKartenZoom(12));
    expect(result.current.kritisZoomZuKlein).toBe(false);
  });
});
