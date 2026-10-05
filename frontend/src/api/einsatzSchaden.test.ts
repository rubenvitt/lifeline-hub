import { afterEach, describe, expect, it, vi } from 'vitest';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import type { UploadFortschritt } from './client';
import {
  entferneSchadenAnhang,
  legeSchadenAnhangAb,
  listeSchadenAnhaenge,
  schadenAnhangDownloadPfad,
} from './einsatzSchaden';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    const anfragen = installiereXhrAttrappe();
    const datei = new File(['x'], 'dach.jpg', { type: 'image/jpeg' });
    const ergebnis = legeSchadenAnhangAb(7, 3, datei);
    const [xhr] = anfragen;
    expect(xhr.url).toBe('/api/einsaetze/7/schaeden/3/anhaenge');
    expect(xhr.methode).toBe('POST');
    const fd = xhr.body as FormData;
    expect(fd.get('datei')).toBe(datei);
    expect([...fd.keys()]).toEqual(['datei']);
    expect(xhr.timeout).toBe(120_000);
    xhr.antworten(201, { id: 1 });
    await expect(ergebnis).resolves.toEqual({ id: 1 });
  });

  it('reicht den Fortschritt an den Aufrufer durch (LFH-878)', () => {
    const anfragen = installiereXhrAttrappe();
    const meldungen: UploadFortschritt[] = [];
    void legeSchadenAnhangAb(7, 3, new File(['x'], 'dach.jpg'), (f) => meldungen.push(f));
    anfragen[0].fortschritt(1, 2);
    anfragen[0].uebertragen();
    expect(meldungen).toEqual([{ phase: 'senden', anteil: 0.5 }, { phase: 'pruefen' }]);
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
