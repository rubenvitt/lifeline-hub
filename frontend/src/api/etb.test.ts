import { afterEach, describe, expect, it, vi } from 'vitest';
import { etbAnhangPfad, ladeEtbAnhangHoch } from './etb';

afterEach(() => vi.restoreAllMocks());

describe('ETB-Anhänge (LFH-117)', () => {
  it('lädt EINE Datei über den ETB-Upload hoch und liefert ihre Anzeige', async () => {
    const anzeige = { id: 5, dateiname: 'foto.jpg', mime: 'image/jpeg', groesse: 1 };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([anzeige]), { status: 201 }));
    const datei = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });

    await expect(ladeEtbAnhangHoch(7, datei)).resolves.toEqual(anzeige);

    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/etb/anhaenge');
    const fd = init?.body as FormData;
    expect(fd.getAll('datei')).toEqual([datei]);
  });

  it('nutzt das 120-s-Upload-Timeout, nicht das 15-s-Standard-Timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ id: 1 }]), { status: 201 }),
    );
    await ladeEtbAnhangHoch(7, new File(['x'], 'a.jpg'));
    expect(timeout).toHaveBeenCalledWith(120_000);
  });

  it('baut den Download-Pfad unter dem ETB-Präfix — nie den generischen', () => {
    expect(etbAnhangPfad(7, 42, 9)).toBe('/api/einsaetze/7/etb/42/anhaenge/9');
    expect(etbAnhangPfad(7, 42, 9)).not.toMatch(/^\/api\/einsaetze\/7\/anhaenge/);
  });
});
