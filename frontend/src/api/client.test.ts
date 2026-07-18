import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { ApiError, apiGet, apiSend, istKonflikt } from './client';

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

  it('liefert undefined bei 204 ohne Body', async () => {
    server.use(http.post('/api/logout', () => new HttpResponse(null, { status: 204 })));
    await expect(apiSend('/api/logout', 'POST')).resolves.toBeUndefined();
  });

  it('liefert undefined bei 201 ohne Body (z.B. WebAuthn-Finish-Endpunkte, LFH-275)', async () => {
    server.use(http.post('/api/ding', () => new HttpResponse(null, { status: 201 })));
    await expect(apiSend('/api/ding', 'POST', {})).resolves.toBeUndefined();
  });

  it('wirft kein ApiError, sondern den nativen TypeError bei Netzwerkfehler', async () => {
    server.use(http.post('/api/ding', () => HttpResponse.error()));
    const fehler = await apiSend('/api/ding', 'POST', {}).catch((e) => e);
    expect(fehler).not.toBeInstanceOf(ApiError);
  });
});
