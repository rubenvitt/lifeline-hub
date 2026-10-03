import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  entfernePersonAnhang,
  ladePersonenDruck,
  legePersonAnhangAb,
  listePersonAnhaenge,
  personAnhangDownloadPfad,
} from './einsatzPerson';

afterEach(() => vi.restoreAllMocks());

// LFH-727: Der Personendruck lädt über den protokollierenden Druck-Endpunkt, nie über die Liste.
describe('ladePersonenDruck', () => {
  it('ruft genau GET /api/einsaetze/{id}/personen/druck', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await expect(ladePersonenDruck(7)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/personen/druck');
    expect(init?.method ?? 'GET').toBe('GET');
  });
});

// LFH-757: Anhänge an einer Person laufen ausschließlich über die Personenroute.
describe('Personen-Anhänge-API', () => {
  it('listet über die Personenroute', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await listePersonAnhaenge(7, 3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/einsaetze/7/personen/3/anhaenge');
  });

  it('legt EINE Datei im Feld `datei` ab, mit dem 120-s-Upload-Timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    const datei = new File(['x'], 'verletzung.jpg', { type: 'image/jpeg' });
    await legePersonAnhangAb(7, 3, datei);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/personen/3/anhaenge');
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
    await entfernePersonAnhang(7, 3, 42);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/personen/3/anhaenge/42');
    expect(init?.method).toBe('DELETE');
  });

  it('baut den Download-Pfad an der Personenroute, nie an /anhaenge des Einsatzes', () => {
    const p = personAnhangDownloadPfad(7, 3, 42);
    expect(p).toBe('/api/einsaetze/7/personen/3/anhaenge/42/datei');
    expect(p.startsWith('/api/einsaetze/7/anhaenge')).toBe(false);
  });
});
