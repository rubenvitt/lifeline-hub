import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRef, type ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';
import { listeHintergrundbilder, type Hintergrundbild } from '../../api/kartenbilder';
import { AusgangUnbekannt, type UploadFortschritt } from '../../api/client';
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
  uploads: [] as {
    onFortschritt: (stand: UploadFortschritt) => void;
    aufloesen: (bild: unknown) => void;
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
  ladeHintergrundbildHoch: vi.fn(
    (
      _einsatzId: number,
      _datei: File,
      _ecken: unknown,
      _name?: string,
      _ansichtId?: number | null,
      onFortschritt?: (stand: UploadFortschritt) => void,
    ) =>
      new Promise((aufloesen, ablehnen) => {
        api.uploads.push({ onFortschritt: onFortschritt!, aufloesen, ablehnen });
      }),
  ),
  loescheHintergrundbild: vi.fn(),
}));

const ladeLageSnapshot = vi.hoisted(() => vi.fn());
vi.mock('../../api/lageSnapshot', () => ({ ladeLageSnapshot }));

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
  api.uploads.length = 0;
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    const fehler = vi.fn();
    const qc = neuerQueryClient();
    const { result } = renderHook(
      () =>
        useKartenbilder({
          einsatzId: 5,
          kartenRef: createRef<KartenHandle>(),
          bildPlatzierenId: null,
          quelle: { typ: 'snapshot', id: 9 },
          fehler,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(api.downloads).toHaveLength(2));

    await act(async () => {
      api.downloads.find((d) => d.id === 1)?.aufloesen('blob:eins');
      api.downloads.find((d) => d.id === 2)?.ablehnen(new Error('Download fehlgeschlagen (404)'));
    });

    await waitFor(() => expect(result.current.bildOverlays.map((o) => o.id)).toEqual([1]));
    expect(fehler).toHaveBeenCalledTimes(1);
    expect(String(fehler.mock.calls[0][0])).toMatch(/404/);
  });
});

describe('useKartenbilder: Upload (LFH-1021)', () => {
  /** jsdom lädt keine Bilder: das Seitenverhältnis fällt auf den Ersatz zurück. */
  function ohneBildDekodierung() {
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        set src(_url: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:vorschau');
    vi.mocked(listeHintergrundbilder).mockClear();
  }
  const datei = () => new File(['x'], 'grundriss.png', { type: 'image/png' });

  it('meldet den Fortschritt, sperrt einen zweiten Upload und räumt nach Erfolg', async () => {
    ohneBildDekodierung();
    const { hook } = aufbau();
    await waitFor(() => expect(listeHintergrundbilder).toHaveBeenCalledTimes(1));
    expect(hook.result.current.bildUpload).toEqual({ laeuft: false, stand: null, fehler: null });

    act(() => hook.result.current.onBildUpload(datei()));
    await waitFor(() => expect(api.uploads).toHaveLength(1));
    expect(hook.result.current.bildUpload.laeuft).toBe(true);
    expect(hook.result.current.bildUpload.stand).toEqual({ phase: 'senden', anteil: null });

    act(() => api.uploads[0].onFortschritt({ phase: 'senden', anteil: 0.5 }));
    expect(hook.result.current.bildUpload.stand).toEqual({ phase: 'senden', anteil: 0.5 });
    act(() => api.uploads[0].onFortschritt({ phase: 'pruefen' }));
    expect(hook.result.current.bildUpload.stand).toEqual({ phase: 'pruefen' });

    act(() => hook.result.current.onBildUpload(datei()));
    await act(async () => api.uploads[0].aufloesen(bild(9)));
    await waitFor(() => expect(hook.result.current.bildUpload.laeuft).toBe(false));
    expect(api.uploads).toHaveLength(1);
    expect(hook.result.current.bildUpload.stand).toBeNull();
    await waitFor(() => expect(listeHintergrundbilder).toHaveBeenCalledTimes(2));
  });

  it('unklarer Ausgang: Fehler an der Liste statt im Toast, und die Liste wird neu geholt', async () => {
    ohneBildDekodierung();
    const { hook, fehler } = aufbau();
    await waitFor(() => expect(listeHintergrundbilder).toHaveBeenCalledTimes(1));

    act(() => hook.result.current.onBildUpload(datei()));
    await waitFor(() => expect(api.uploads).toHaveLength(1));
    const unklar = new AusgangUnbekannt();
    await act(async () => api.uploads[0].ablehnen(unklar));

    await waitFor(() => expect(hook.result.current.bildUpload.fehler).toBe(unklar));
    expect(hook.result.current.bildUpload.stand).toBeNull();
    expect(fehler).not.toHaveBeenCalled();
    await waitFor(() => expect(listeHintergrundbilder).toHaveBeenCalledTimes(2));

    // Der nächste Upload räumt den alten Fehler.
    act(() => hook.result.current.onBildUpload(datei()));
    await waitFor(() => expect(hook.result.current.bildUpload.fehler).toBeNull());
  });
});
