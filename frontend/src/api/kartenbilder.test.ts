import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  bildDownloadPfad,
  ladeBildBlobUrl,
  ladeHintergrundbildHoch,
  listeHintergrundbilder,
} from './kartenbilder';

describe('kartenbilder API', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('liste ruft den richtigen Pfad', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200 }),
    );
    await listeHintergrundbilder(7);
    expect(fetchMock).toHaveBeenCalledWith('/api/einsaetze/7/karte/hintergrundbilder', expect.anything());
  });

  it('download-pfad ist stabil', () => {
    expect(bildDownloadPfad(7, 3)).toBe('/api/einsaetze/7/karte/hintergrundbilder/3/download');
  });

  it('begrenzt auch den direkten Bilddownload auf 15 Sekunden', async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['bild']), { status: 200 }),
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');

    await expect(ladeBildBlobUrl(7, 3)).resolves.toBe('blob:test');
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/einsaetze/7/karte/hintergrundbilder/3/download',
      expect.objectContaining({ credentials: 'same-origin', signal }),
    );
  });

  it('upload hängt datei + ecken als FormData an', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"id":1}', { status: 201 }),
    );
    const datei = new File([new Uint8Array([0x89])], 'plan.png', { type: 'image/png' });
    await ladeHintergrundbildHoch(7, datei, [[9,50],[9.1,50],[9.1,49.9],[9,49.9]]);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.body).toBeInstanceOf(FormData);
    const fd = init!.body as FormData;
    expect(fd.get('datei')).toBeInstanceOf(File);
    expect(fd.get('ecken')).toBe('[[9,50],[9.1,50],[9.1,49.9],[9,49.9]]');
  });
});
