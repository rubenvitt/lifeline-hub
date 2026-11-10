import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import {
  ANHANG_WIRD_GEHOLT_TEXT,
  AnhangWirdGeholt,
  isAnhangWirdGeholt,
  checkAnhangAbruf,
  throwIfWirdGeholt,
} from './anhangAbruf';
import { ApiError } from './client';
import { ladeBildBlobUrl } from './kartenbilder';
import { ladePlanBild } from './uhsPlan';

const PFAD = '/api/einsaetze/7/etb/1/anhaenge/2';

describe('Anhänge auf Abruf am Spiegel (LLH-1492, design.md D8)', () => {
  it('erkennt „wird geholt“ an der 409 mit dem Text des Servers, nicht an jeder 409', () => {
    expect(isAnhangWirdGeholt(new ApiError(409, ANHANG_WIRD_GEHOLT_TEXT))).toBe(true);
    expect(isAnhangWirdGeholt(new AnhangWirdGeholt())).toBe(true);
    expect(isAnhangWirdGeholt(new ApiError(409, 'Zwischenzeitlich geändert'))).toBe(false);
    expect(isAnhangWirdGeholt(new ApiError(404, ANHANG_WIRD_GEHOLT_TEXT))).toBe(false);
  });

  it('wirft bei der 409 eines Inhaltsabrufs „wird geholt“', async () => {
    await expect(
      throwIfWirdGeholt(
        new Response(JSON.stringify({ error: ANHANG_WIRD_GEHOLT_TEXT }), { status: 409 }),
      ),
    ).rejects.toBeInstanceOf(AnhangWirdGeholt);
    await expect(
      throwIfWirdGeholt(new Response(JSON.stringify({ error: 'anders' }), { status: 409 })),
    ).resolves.toBeUndefined();
    await expect(throwIfWirdGeholt(new Response('x', { status: 200 }))).resolves.toBeUndefined();
  });

  it('fragt nach: bereit, wird geholt oder Fehler', async () => {
    server.use(
      http.get(PFAD, () => HttpResponse.json({ error: ANHANG_WIRD_GEHOLT_TEXT }, { status: 409 })),
    );
    await expect(checkAnhangAbruf(PFAD)).resolves.toBe('wird_geholt');
    server.use(http.get(PFAD, () => new HttpResponse('bild', { status: 200 })));
    await expect(checkAnhangAbruf(PFAD)).resolves.toBe('bereit');
    server.use(http.get(PFAD, () => HttpResponse.json({ error: 'weg' }, { status: 404 })));
    await expect(checkAnhangAbruf(PFAD)).resolves.toBe('fehler');
  });

  it('ein Kartenhintergrund, der geholt wird, ist kein Ladefehler', async () => {
    server.use(
      http.get('/api/einsaetze/7/karte/hintergrundbilder/3/download', () =>
        HttpResponse.json({ error: ANHANG_WIRD_GEHOLT_TEXT }, { status: 409 }),
      ),
    );
    await expect(ladeBildBlobUrl(7, 3)).rejects.toBeInstanceOf(AnhangWirdGeholt);
  });

  it('ein UHS-Plan, der geholt wird, ebenso', async () => {
    server.use(
      http.get('/api/einsaetze/7/uhs/2/plan/bild', () =>
        HttpResponse.json({ error: ANHANG_WIRD_GEHOLT_TEXT }, { status: 409 }),
      ),
    );
    await expect(ladePlanBild(7, 2, 'abc')).rejects.toBeInstanceOf(AnhangWirdGeholt);
  });
});
