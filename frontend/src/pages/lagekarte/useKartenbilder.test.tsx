import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../../test/server';
import { neuerQueryClient } from '../../test/utils';
import type { Hintergrundbild } from '../../api/kartenbilder';

const ladeLageSnapshot = vi.fn();
vi.mock('../../api/lageSnapshot', () => ({
  ladeLageSnapshot: (...a: unknown[]) => ladeLageSnapshot(...a),
}));

import { useKartenbilder } from './useKartenbilder';

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function bild(id: number): Hintergrundbild {
  return {
    id,
    einsatz_id: 5,
    name: `Bild ${id}`,
    mime: 'image/png',
    groesse: 4,
    ecken_json: '[[0,0],[1,0],[1,1],[0,1]]',
    opazitaet: 100,
    sichtbar: true,
    reihenfolge: id,
    hochgeladen_von: 1,
    erstellt_at: '2026-07-24 08:00:00',
    geaendert_at: '2026-07-24 08:00:00',
  };
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('useKartenbilder im Rückblick', () => {
  // LFH-997: Nach der Schwärzung des Einsatzes oder seiner Kategorie „Anhänge“ sind die Bilder der
  // Lagekarte gelöscht; ein Lage-Stand nennt sie weiter. Wie bei einem im Einsatz gelöschten Bild
  // erscheint ein Hinweis, die übrigen Bilder werden gezeichnet.
  it('zeichnet vorhandene Bilder und meldet ein gelöschtes als Hinweis', async () => {
    ladeLageSnapshot.mockResolvedValue({
      id: 9,
      einsatz_id: 5,
      stand_at: '2026-07-24 08:00:00',
      schema_version: 1,
      daten: { bilder: [bild(1), bild(2)] },
    });
    server.use(
      http.get(
        '/api/einsaetze/5/karte/hintergrundbilder/1/download',
        () => new HttpResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
      ),
      http.get(
        '/api/einsaetze/5/karte/hintergrundbilder/2/download',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    const fehler = vi.fn();

    const { result } = renderHook(
      () =>
        useKartenbilder({
          einsatzId: 5,
          kartenRef: { current: null },
          bildPlatzierenId: null,
          quelle: { typ: 'snapshot', id: 9 },
          fehler,
        }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.bildOverlays.map((o) => o.id)).toEqual([1]));
    await waitFor(() => expect(fehler).toHaveBeenCalledTimes(1));
    expect(String(fehler.mock.calls[0][0])).toMatch(/404/);
  });
});
