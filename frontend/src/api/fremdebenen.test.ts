import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import {
  aktualisiereFremdebene,
  FREMDEBENE_FEHLERTEXT,
  FREMDEBENE_GRENZEN,
  ladeFremdebeneDaten,
  legeFremdebeneAn,
  listeFremdebenen,
  loescheFremdebene,
} from './fremdebenen';
import { einsatzKeys, EINSATZ_STREAM_EVENTS, istLagebildOfflineKey } from './queryKeys';

const BASIS = '/api/incidents/7/map/foreign-layers';

describe('fremdebenen API (LLH-2099)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('liste und Daten rufen die Pfade unter map/foreign-layers', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('[]', { status: 200 }));
    await listeFremdebenen(7);
    await ladeFremdebeneDaten(7, 3);
    expect(fetchMock.mock.calls[0][0]).toBe(BASIS);
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASIS}/3/data`);
  });

  it('PATCH und DELETE gehen an die Ebene', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{}', { status: 200 }));
    await aktualisiereFremdebene(7, 3, { name: 'Neu', color: 'fremd-2' });
    await loescheFremdebene(7, 3);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASIS}/3`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ name: 'Neu', color: 'fremd-2' }),
    );
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASIS}/3`);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');
  });

  it('anlegen aus Datei trägt genau file (und name), nie url', () => {
    const anfragen = installiereXhrAttrappe();
    const datei = new File(['{}'], 'a.geojson');
    void legeFremdebeneAn(7, { name: 'Suchgebiete', datei });
    const [xhr] = anfragen;
    expect(xhr.methode).toBe('POST');
    expect(xhr.url).toBe(BASIS);
    expect(xhr.timeout).toBe(120_000);
    const fd = xhr.body as FormData;
    expect(fd.get('file')).toBe(datei);
    expect(fd.has('url')).toBe(false);
    expect(fd.get('name')).toBe('Suchgebiete');
  });

  it('anlegen aus Adresse trägt genau url, nie file', () => {
    const anfragen = installiereXhrAttrappe();
    void legeFremdebeneAn(7, { name: '', url: 'https://x.example/a.kml' });
    const fd = anfragen[0].body as FormData;
    expect(fd.get('url')).toBe('https://x.example/a.kml');
    expect(fd.has('file')).toBe(false);
    expect(fd.has('name')).toBe(false);
  });

  it('Grenzen und Fehlertexte stehen wortgleich zum Server', () => {
    expect(FREMDEBENE_GRENZEN).toEqual({ dateiBytes: 10 * 1024 * 1024, nameMax: 120 });
    expect(Object.keys(FREMDEBENE_FEHLERTEXT)).toHaveLength(13);
    expect(FREMDEBENE_FEHLERTEXT.koordinaten).toBe(
      'Die Koordinaten liegen außerhalb der Erde. Ist die Datei in WGS84?',
    );
  });

  it('Keys: Live-Ereignis trifft beide, nur die Liste liegt im Lagebild-Speicher', () => {
    expect(einsatzKeys.fremdebenen(7)).toEqual(['einsatz-fremdebenen', 7]);
    expect(einsatzKeys.fremdebeneDaten(7, 3)).toEqual(['einsatz-fremdebene-daten', 7, 3]);
    expect(EINSATZ_STREAM_EVENTS.karte_fremdebene).toHaveLength(2);
    expect(istLagebildOfflineKey(einsatzKeys.fremdebenen(7))).toBe(true);
    expect(istLagebildOfflineKey(einsatzKeys.fremdebeneDaten(7, 3))).toBe(true);
  });
});
