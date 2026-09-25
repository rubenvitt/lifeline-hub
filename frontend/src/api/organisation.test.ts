import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  entferneOrgLogo,
  ladeOrgLogoHoch,
  orgLogoPfad,
  setzeOrgDefault,
  setzeOrgName,
} from './organisation';

/**
 * Pfad, Methode und Body der Organisations-Aufrufe (LFH-22, design.md D7/D8). Der Server
 * nimmt beim PATCH beide Felder optional; wer hier ein Feld mitschickt, das er nicht ändern
 * will, überschreibt es.
 */
describe('api/organisation', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{"id":1,"name":"X"}', { status: 200 }));
  });

  function aufruf(): { pfad: string; init: RequestInit } {
    const [pfad, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { pfad, init };
  }

  it('setzeOrgName schickt NUR den Namen per PATCH', async () => {
    await setzeOrgName('DRK Kreisverband Musterstadt');
    const { pfad, init } = aufruf();
    expect(pfad).toBe('/api/organisation');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'DRK Kreisverband Musterstadt' });
  });

  it('setzeOrgDefault bleibt beim Bestandsaufruf mit nur tz_organisation', async () => {
    await setzeOrgDefault('thw');
    expect(JSON.parse(aufruf().init.body as string)).toEqual({ tz_organisation: 'thw' });
  });

  it('ladeOrgLogoHoch schickt die Datei als Multipart-Feld `datei` per POST', async () => {
    const datei = new File([new Uint8Array([0x89, 0x50])], 'logo.png', { type: 'image/png' });
    await ladeOrgLogoHoch(datei);
    const { pfad, init } = aufruf();
    expect(pfad).toBe('/api/organisation/logo');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('datei')).toBe(datei);
    // Kein eigener Content-Type: die Boundary setzt der Browser.
    expect(init.headers).toBeUndefined();
  });

  it('entferneOrgLogo ruft DELETE auf den Logo-Pfad', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await entferneOrgLogo();
    const { pfad, init } = aufruf();
    expect(pfad).toBe('/api/organisation/logo');
    expect(init.method).toBe('DELETE');
  });

  it('orgLogoPfad hängt den sha256 als Cache-Brecher an', () => {
    expect(orgLogoPfad('abc123')).toBe('/api/organisation/logo?v=abc123');
  });
});
