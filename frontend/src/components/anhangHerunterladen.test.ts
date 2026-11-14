import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { ANHANG_WIRD_GEHOLT_TEXT } from '../api/anhangAbruf';
import { ladeAnhangHerunter } from './anhangHerunterladen';
import * as speichern from './dateiSpeichern';

const HREF = '/api/einsaetze/7/etb/1/anhaenge/3';

describe('ladeAnhangHerunter (Review L2)', () => {
  let gespeichert: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    gespeichert = vi.spyOn(speichern, 'speichereDatei').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('am Spiegel: „wird geholt“ wird gemeldet, nicht als Datei gespeichert', async () => {
    server.use(
      http.get(HREF, () => HttpResponse.json({ error: ANHANG_WIRD_GEHOLT_TEXT }, { status: 409 })),
    );
    const melde = vi.fn();
    await ladeAnhangHerunter(HREF, 'dach.jpg', { spiegel: true, melde });
    expect(gespeichert).not.toHaveBeenCalled();
    expect(melde).toHaveBeenCalledWith(
      'info',
      'dach.jpg: wird geholt, nach dem nächsten Abgleich erneut versuchen',
    );
  });

  it('am Spiegel: ein geladener Anhang wird gespeichert', async () => {
    server.use(http.get(HREF, () => new HttpResponse('x', { status: 200 })));
    const melde = vi.fn();
    await ladeAnhangHerunter(HREF, 'dach.jpg', { spiegel: true, melde });
    // Node und jsdom haben je ein eigenes `Blob`: geprüft werden Aufruf und Name.
    expect(gespeichert).toHaveBeenCalledTimes(1);
    expect(gespeichert.mock.calls[0][1]).toBe('dach.jpg');
    expect(melde).not.toHaveBeenCalled();
  });

  it('am Spiegel: ein anderer Fehler wird als Fehler gemeldet', async () => {
    server.use(http.get(HREF, () => HttpResponse.json({ error: 'Kaputt' }, { status: 500 })));
    const melde = vi.fn();
    await ladeAnhangHerunter(HREF, 'dach.jpg', { spiegel: true, melde });
    expect(gespeichert).not.toHaveBeenCalled();
    expect(melde).toHaveBeenCalledWith('error', expect.stringMatching(/^dach\.jpg: /));
  });

  it('ohne Spiegel: der Browser lädt über einen Verweis, wie ein Klick auf ihn', async () => {
    const klick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.getAttribute('href')).toBe(HREF);
      expect(this.download).toBe('dach.jpg');
    });
    await ladeAnhangHerunter(HREF, 'dach.jpg', { spiegel: false, melde: vi.fn() });
    expect(klick).toHaveBeenCalledTimes(1);
    expect(gespeichert).not.toHaveBeenCalled();
  });
});
