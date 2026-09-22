import { afterEach, describe, expect, it, vi } from 'vitest';
import { dokumentDownloadPfad, legeDokumentAb } from './dokumente';

afterEach(() => vi.restoreAllMocks());

describe('dokumente-API', () => {
  it('schickt Datei und Metadaten in EINEM Multipart', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    const datei = new File(['x'], 'plan.pdf', { type: 'application/pdf' });
    await legeDokumentAb(7, {
      datei,
      titel: 'Plan',
      kategorie: 'lagekarte_plan',
      bezug: { typ: 'abschnitt', id: 3 },
    });
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/dokumente');
    const fd = init?.body as FormData;
    expect(fd.get('datei')).toBe(datei);
    expect(fd.get('titel')).toBe('Plan');
    expect(fd.get('kategorie')).toBe('lagekarte_plan');
    expect(fd.get('bezug_typ')).toBe('abschnitt');
    expect(fd.get('bezug_id')).toBe('3');
  });

  it('lässt den Bezug ohne Angabe ganz weg', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    await legeDokumentAb(7, { datei: new File(['x'], 'a.pdf'), titel: 'A', kategorie: 'foto' });
    const fd = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(fd.has('bezug_typ')).toBe(false);
    expect(fd.has('bezug_id')).toBe(false);
  });

  it('baut den Download-Pfad', () => {
    expect(dokumentDownloadPfad(7, 42)).toBe('/api/einsaetze/7/dokumente/42/datei');
  });

  it('nutzt das 120-s-Upload-Timeout, nicht das 15-s-Standard-Timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), { status: 201 }),
    );
    await legeDokumentAb(7, { datei: new File(['x'], 'a.pdf'), titel: 'A', kategorie: 'foto' });
    expect(timeout).toHaveBeenCalledWith(120_000);
  });
});
