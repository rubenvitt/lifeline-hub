import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  entferneSchadenAnhang,
  legeSchadenAnhangAb,
  listeSchadenAnhaenge,
  schadenAnhangDownloadPfad,
} from './einsatzSchaden';

afterEach(() => vi.restoreAllMocks());

// LFH-21: Anhänge an einem Schaden laufen ausschließlich über die Schadensroute.
describe('Schaden-Anhänge-API', () => {
  it('listet über die Schadensroute', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await listeSchadenAnhaenge(7, 3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/einsaetze/7/schaeden/3/anhaenge');
  });

  it('legt EINE Datei im Feld `datei` ab, mit dem 120-s-Upload-Timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    const datei = new File(['x'], 'dach.jpg', { type: 'image/jpeg' });
    await legeSchadenAnhangAb(7, 3, datei);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/schaeden/3/anhaenge');
    expect(init?.method).toBe('POST');
    const fd = init?.body as FormData;
    expect(fd.get('datei')).toBe(datei);
    expect([...fd.keys()]).toEqual(['datei']);
    expect(timeout).toHaveBeenCalledWith(120_000);
  });

  it('entfernt per DELETE auf die Linker-id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await entferneSchadenAnhang(7, 3, 42);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/schaeden/3/anhaenge/42');
    expect(init?.method).toBe('DELETE');
  });

  it('baut den Download-Pfad an der Schadensroute, nie an /anhaenge des Einsatzes', () => {
    const p = schadenAnhangDownloadPfad(7, 3, 42);
    expect(p).toBe('/api/einsaetze/7/schaeden/3/anhaenge/42/datei');
    expect(p.startsWith('/api/einsaetze/7/anhaenge')).toBe(false);
  });
});
