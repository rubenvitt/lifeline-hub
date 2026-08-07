import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import {
  ApiError,
  NetzFehler,
  OFFLINE_QUEUE_BENUTZER_HEADER,
  apiGet,
  apiSend,
  fehlerText,
  istKonflikt,
} from './client';

afterEach(() => vi.restoreAllMocks());

describe('istKonflikt', () => {
  it('erkennt einen 409-ApiError als optimistischen Sperrkonflikt', () => {
    expect(istKonflikt(new ApiError(409, 'geändert'))).toBe(true);
  });
  it('ist false für andere Status und Nicht-ApiError', () => {
    expect(istKonflikt(new ApiError(404, 'weg'))).toBe(false);
    expect(istKonflikt(new ApiError(422, 'ungültig'))).toBe(false);
    expect(istKonflikt(new Error('boom'))).toBe(false);
    expect(istKonflikt(null)).toBe(false);
  });
});

describe('apiGet', () => {
  it('liefert geparstes JSON bei 200', async () => {
    server.use(http.get('/api/ding', () => HttpResponse.json({ wert: 42 })));
    await expect(apiGet<{ wert: number }>('/api/ding')).resolves.toEqual({ wert: 42 });
  });

  it('wirft ApiError mit Server-Meldung bei Fehlerstatus', async () => {
    server.use(
      http.get('/api/ding', () => HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 })),
    );
    await expect(apiGet('/api/ding')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Nicht gefunden',
    });
  });

  it('bricht einen hängenden Fetch nach dem 15-s-Signal als NetzFehler ab', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((millisekunden) => {
      expect(millisekunden).toBe(15_000);
      return controller.signal;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const anfrage = apiGet('/api/haengt');
    controller.abort(new DOMException('Zeitüberschreitung', 'TimeoutError'));

    await expect(anfrage).rejects.toBeInstanceOf(NetzFehler);
  });

  it('ordnet auch einen expliziten AbortError als NetzFehler ein', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('Verbindung abgebrochen', 'AbortError'),
    );
    await expect(apiGet('/api/abgebrochen')).rejects.toBeInstanceOf(NetzFehler);
  });
});

describe('apiSend', () => {
  it('serialisiert den Body und liefert die Antwort', async () => {
    server.use(
      http.post('/api/ding', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json({ gruss: `Hallo ${body.name}` }, { status: 201 });
      }),
    );
    await expect(apiSend('/api/ding', 'POST', { name: 'Welt' })).resolves.toEqual({
      gruss: 'Hallo Welt',
    });
  });

  it('sendet die optionale erwartete Queue-Eigentümer-ID als eigenen Header', async () => {
    let header: string | null = null;
    server.use(
      http.post('/api/offline-ding', ({ request }) => {
        header = request.headers.get(OFFLINE_QUEUE_BENUTZER_HEADER);
        return HttpResponse.json({ gespeichert: true }, { status: 201 });
      }),
    );

    await apiSend('/api/offline-ding', 'POST', { name: 'Welt' }, {
      offlineQueueBenutzerId: 17,
    });

    expect(header).toBe('17');
  });

  it('liefert undefined bei 204 ohne Body', async () => {
    server.use(http.post('/api/logout', () => new HttpResponse(null, { status: 204 })));
    await expect(apiSend('/api/logout', 'POST')).resolves.toBeUndefined();
  });

  it('liefert undefined bei 201 ohne Body (z.B. WebAuthn-Finish-Endpunkte, LFH-275)', async () => {
    server.use(http.post('/api/ding', () => new HttpResponse(null, { status: 201 })));
    await expect(apiSend('/api/ding', 'POST', {})).resolves.toBeUndefined();
  });

  it('bündelt TypeError und liefert den eindeutigen Bedienhinweis', async () => {
    server.use(http.post('/api/ding', () => HttpResponse.error()));
    const fehler = await apiSend('/api/ding', 'POST', {}).catch((e) => e);
    expect(fehler).toBeInstanceOf(NetzFehler);
    expect(fehlerText(fehler)).toBe('Keine Verbindung — die Aktion wurde NICHT abgeschickt');
  });

  it('lässt eine 409-Antwort unverändert als optimistischen Sperrkonflikt erkennen', async () => {
    server.use(
      http.post('/api/ding', () =>
        HttpResponse.json({ error: 'Zwischenzeitlich geändert' }, { status: 409 }),
      ),
    );
    const fehler = await apiSend('/api/ding', 'POST', {}).catch((e) => e);
    expect(istKonflikt(fehler)).toBe(true);
  });
});
