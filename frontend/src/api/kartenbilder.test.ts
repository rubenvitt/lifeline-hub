import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import { AusgangUnbekannt, type UploadFortschritt } from './client';
import {
  bildDownloadPfad,
  ladeBildBlobUrl,
  ladeHintergrundbildHoch,
  listeHintergrundbilder,
  type Ecken,
} from './kartenbilder';

const ECKEN: Ecken = [
  [9, 50],
  [9.1, 50],
  [9.1, 49.9],
  [9, 49.9],
];

describe('kartenbilder API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('liste ruft den richtigen Pfad', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await listeHintergrundbilder(7);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/einsaetze/7/karte/hintergrundbilder',
      expect.anything(),
    );
  });

  it('download-pfad ist stabil', () => {
    expect(bildDownloadPfad(7, 3)).toBe('/api/einsaetze/7/karte/hintergrundbilder/3/download');
  });

  it('begrenzt auch den direkten Bilddownload auf 15 Sekunden', async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['bild']), { status: 200 }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');

    await expect(ladeBildBlobUrl(7, 3)).resolves.toBe('blob:test');
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/einsaetze/7/karte/hintergrundbilder/3/download',
      expect.objectContaining({ credentials: 'same-origin', signal }),
    );
  });

  it('bricht mit dem Signal des Aufrufers ab, die 15-s-Grenze bleibt (LFH-943)', async () => {
    const grenze = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(grenze.signal);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(new Blob(['bild']), { status: 200 }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const aufrufer = new AbortController();

    await ladeBildBlobUrl(7, 3, aufrufer.signal);
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    aufrufer.abort();
    expect(signal.aborted).toBe(true);

    await ladeBildBlobUrl(7, 3, new AbortController().signal);
    const zweites = fetchMock.mock.calls[1][1]?.signal as AbortSignal;
    grenze.abort();
    expect(zweites.aborted).toBe(true);
  });

  it('ohne AbortSignal.any: Abbruch wirkt, und nach dem Download hängt kein Hörer mehr am Signal', async () => {
    const original = AbortSignal.any;
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
    try {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response(new Blob(['bild']), { status: 200 }));
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      const aufrufer = new AbortController();
      const an = vi.spyOn(aufrufer.signal, 'addEventListener');
      const ab = vi.spyOn(aufrufer.signal, 'removeEventListener');

      for (let i = 0; i < 3; i += 1) await ladeBildBlobUrl(7, 3, aufrufer.signal);
      expect(an).toHaveBeenCalledTimes(3);
      expect(ab.mock.calls.map((c) => c[1])).toEqual(an.mock.calls.map((c) => c[1]));

      // Läuft der Download noch, schlägt der Abbruch des Aufrufers durch.
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(
        (_pfad, init) =>
          new Promise((_ok, fehler) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener('abort', () => fehler(signal?.reason));
          }),
      );
      const laeuft = ladeBildBlobUrl(7, 3, aufrufer.signal);
      aufrufer.abort();
      await expect(laeuft).rejects.toBeDefined();
      expect(signal?.aborted).toBe(true);
    } finally {
      Object.defineProperty(AbortSignal, 'any', { value: original, configurable: true });
    }
  });

  it('upload hängt datei + ecken als FormData an', async () => {
    const anfragen = installiereXhrAttrappe();
    const datei = new File([new Uint8Array([0x89])], 'plan.png', { type: 'image/png' });
    const ergebnis = ladeHintergrundbildHoch(7, datei, ECKEN, 'Plan', 4);
    const [xhr] = anfragen;
    expect(xhr.methode).toBe('POST');
    expect(xhr.url).toBe('/api/einsaetze/7/karte/hintergrundbilder');
    const fd = xhr.body as FormData;
    expect(fd.get('datei')).toBe(datei);
    expect(fd.get('ecken')).toBe('[[9,50],[9.1,50],[9.1,49.9],[9,49.9]]');
    expect(fd.get('name')).toBe('Plan');
    expect(fd.get('ansicht_id')).toBe('4');
    xhr.antworten(201, { id: 1 });
    await expect(ergebnis).resolves.toEqual({ id: 1 });
  });

  it('upload nutzt das 120-s-Upload-Timeout, nicht das 15-s-Standard-Timeout (LFH-1021)', () => {
    const anfragen = installiereXhrAttrappe();
    void ladeHintergrundbildHoch(7, new File(['x'], 'plan.png'), ECKEN);
    expect(anfragen[0].timeout).toBe(120_000);
  });

  it('upload meldet den Fortschritt an den Aufrufer (LFH-1021)', () => {
    const anfragen = installiereXhrAttrappe();
    const meldungen: UploadFortschritt[] = [];
    void ladeHintergrundbildHoch(7, new File(['x'], 'plan.png'), ECKEN, undefined, null, (f) =>
      meldungen.push(f),
    );
    anfragen[0].fortschritt(1, 4);
    anfragen[0].uebertragen();
    expect(meldungen).toEqual([{ phase: 'senden', anteil: 0.25 }, { phase: 'pruefen' }]);
  });

  it('Zeitlimit nach dem letzten Byte: Ausgang unklar, nicht „nicht abgeschickt“ (LFH-1021)', async () => {
    const anfragen = installiereXhrAttrappe();
    const ergebnis = ladeHintergrundbildHoch(7, new File(['x'], 'plan.png'), ECKEN);
    anfragen[0].uebertragen();
    anfragen[0].zeitlimit();
    await expect(ergebnis).rejects.toBeInstanceOf(AusgangUnbekannt);
  });
});
