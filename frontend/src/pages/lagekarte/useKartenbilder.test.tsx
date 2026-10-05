import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRef, type ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';
import type { Hintergrundbild } from '../../api/kartenbilder';
import type { KartenHandle } from './Kartenflaeche';
import { useKartenbilder } from './useKartenbilder';

/**
 * Bild-URLs der Hintergrundbilder (LFH-943, D4): jede URL wird freigegeben, ob übernommen,
 * verworfen oder beim Aushängen; ein laufender Download startet nicht ein zweites Mal.
 */
const api = vi.hoisted(() => ({
  liste: new Map<number, Hintergrundbild[]>(),
  downloads: [] as {
    einsatzId: number;
    id: number;
    signal?: AbortSignal;
    aufloesen: (url: string) => void;
    ablehnen: (e: unknown) => void;
  }[],
}));

vi.mock('../../api/kartenbilder', () => ({
  listeHintergrundbilder: vi.fn(async (einsatzId: number) => api.liste.get(einsatzId) ?? []),
  ladeBildBlobUrl: vi.fn(
    (einsatzId: number, id: number, signal?: AbortSignal) =>
      new Promise<string>((aufloesen, ablehnen) => {
        api.downloads.push({ einsatzId, id, signal, aufloesen, ablehnen });
      }),
  ),
  aktualisiereHintergrundbild: vi.fn(),
  ladeHintergrundbildHoch: vi.fn(),
  loescheHintergrundbild: vi.fn(),
}));

const bild = (id: number, opazitaet = 80): Hintergrundbild =>
  ({
    id,
    name: `Bild ${id}`,
    ecken_json: '[[9,50],[9.1,50],[9.1,49.9],[9,49.9]]',
    opazitaet,
    sichtbar: true,
    reihenfolge: 0,
    ansicht_id: null,
  }) as unknown as Hintergrundbild;

let revoke: { mock: { calls: unknown[][] } };
beforeEach(() => {
  api.liste.clear();
  api.downloads.length = 0;
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
/** Freigegebene URLs (`forEach(URL.revokeObjectURL)` reicht Index und Array mit). */
const freigegeben = () => revoke.mock.calls.map((aufruf) => aufruf[0]);

function aufbau(einsatzId = 1) {
  const qc = neuerQueryClient();
  const fehler = vi.fn();
  const kartenRef = createRef<KartenHandle>();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ einsatz }: { einsatz: number }) =>
      useKartenbilder({ einsatzId: einsatz, kartenRef, bildPlatzierenId: null, fehler }),
    { wrapper, initialProps: { einsatz: einsatzId } },
  );
  /** Neue Bilderliste wie nach einem Refetch (Live-Kanal, Opazität, Sichtbarkeit). */
  const setzeListe = (einsatz: number, bilder: Hintergrundbild[]) => {
    api.liste.set(einsatz, bilder);
    act(() => {
      qc.setQueryData(einsatzKeys.kartenbilder(einsatz), bilder);
    });
  };
  return { hook, fehler, setzeListe, qc };
}

describe('useKartenbilder: Bild-URLs (LFH-943)', () => {
  it('ein Refetch während des Downloads lädt nicht doppelt und übernimmt die URL', async () => {
    api.liste.set(1, [bild(3)]);
    const { hook, setzeListe } = aufbau();
    await waitFor(() => expect(api.downloads).toHaveLength(1));

    // Opazität geändert: neue Liste, dasselbe Bild.
    setzeListe(1, [bild(3, 40)]);
    setzeListe(1, [bild(3, 50)]);
    await waitFor(() => expect(hook.result.current.bilder[0]?.opazitaet).toBe(50));
    expect(api.downloads).toHaveLength(1);

    await act(async () => api.downloads[0].aufloesen('blob:drei'));
    await waitFor(() => expect(hook.result.current.bildOverlays).toHaveLength(1));
    expect(hook.result.current.bildOverlays[0].blobUrl).toBe('blob:drei');
    expect(freigegeben()).toEqual([]);
  });

  it('Karte verlassen während des Downloads: Abbruch, späte URL sofort freigegeben', async () => {
    api.liste.set(1, [bild(3)]);
    const { hook, fehler } = aufbau();
    await waitFor(() => expect(api.downloads).toHaveLength(1));

    hook.unmount();
    expect(api.downloads[0].signal?.aborted).toBe(true);

    // Kam die Antwort trotzdem noch an, wird ihre URL nicht vergessen.
    await act(async () => api.downloads[0].aufloesen('blob:spaet'));
    expect(freigegeben()).toContain('blob:spaet');
    expect(fehler).not.toHaveBeenCalled();
  });

  it('der Abbruch selbst ist kein Fehler für die Meldung', async () => {
    api.liste.set(1, [bild(3)]);
    const { hook, fehler } = aufbau();
    await waitFor(() => expect(api.downloads).toHaveLength(1));

    hook.unmount();
    await act(async () =>
      api.downloads[0].ablehnen(new DOMException('The operation was aborted.', 'AbortError')),
    );
    expect(fehler).not.toHaveBeenCalled();
  });

  it('ein Bild verlässt die Liste vor der Ankunft: URL sofort freigegeben, kein Overlay', async () => {
    api.liste.set(1, [bild(3)]);
    const { hook, setzeListe } = aufbau();
    await waitFor(() => expect(api.downloads).toHaveLength(1));

    setzeListe(1, []);
    await waitFor(() => expect(hook.result.current.bilder).toHaveLength(0));
    await act(async () => api.downloads[0].aufloesen('blob:geloescht'));
    expect(freigegeben()).toContain('blob:geloescht');
    expect(hook.result.current.bildOverlays).toHaveLength(0);
  });

  it('Einsatzwechsel bricht den laufenden Download ab und gibt die späte URL frei', async () => {
    api.liste.set(1, [bild(3)]);
    api.liste.set(2, [bild(8)]);
    const { hook } = aufbau(1);
    await waitFor(() => expect(api.downloads).toHaveLength(1));

    hook.rerender({ einsatz: 2 });
    expect(api.downloads[0].signal?.aborted).toBe(true);
    await waitFor(() => expect(api.downloads).toHaveLength(2));
    expect(api.downloads[1]).toMatchObject({ einsatzId: 2, id: 8 });
    expect(api.downloads[1].signal?.aborted).toBe(false);

    await act(async () => api.downloads[0].aufloesen('blob:alt'));
    expect(freigegeben()).toContain('blob:alt');
  });

  it('beim Aushängen werden die übernommenen URLs freigegeben', async () => {
    api.liste.set(1, [bild(3)]);
    const { hook } = aufbau();
    await waitFor(() => expect(api.downloads).toHaveLength(1));
    await act(async () => api.downloads[0].aufloesen('blob:aktiv'));
    await waitFor(() => expect(hook.result.current.bildOverlays).toHaveLength(1));

    hook.unmount();
    expect(freigegeben()).toContain('blob:aktiv');
  });
});
