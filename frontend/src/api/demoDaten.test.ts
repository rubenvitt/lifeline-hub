import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { ApiError } from './client';
import {
  entferneDemoDaten,
  importiereDemoDaten,
  importiereDemoDatenNeu,
  ladeDemoDatenStatus,
} from './demoDaten';
import type { DemoDatenStatus } from './types';

const NIE: DemoDatenStatus = {
  lagen: [
    { lage: 'starkregen', importiert: false },
    { lage: 'stadtfest', importiert: false },
  ],
};

describe('api/demoDaten (LFH-690)', () => {
  it('der Default-Handler ist der echte Serverzustand ohne Freischaltung: 404', async () => {
    // Ohne `server.use()` antwortet der Default aus `test/server.ts`. Er MUSS 404 sein und
    // nicht etwa 200 mit `importiert: false`: sonst zeigten rund dreißig Tests der
    // Einsatzliste für einen Admin still den Hinweis, den es ohne Freischaltung nicht gibt.
    const fehler = await ladeDemoDatenStatus().catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(ApiError);
    expect((fehler as ApiError).status).toBe(404);
  });

  it('die Vorgänge treffen Methode und Pfad je Lage (LLH-1576)', async () => {
    const gesehen: string[] = [];
    const merke = ({ request }: { request: Request }) => {
      gesehen.push(`${request.method} ${new URL(request.url).pathname}`);
      return HttpResponse.json(NIE);
    };
    server.use(
      http.get('/api/demo-daten', merke),
      http.post('/api/demo-daten/:lage', merke),
      http.post('/api/demo-daten/:lage/neu', merke),
      http.delete('/api/demo-daten/:lage', merke),
    );
    await ladeDemoDatenStatus();
    await importiereDemoDaten('stadtfest');
    await importiereDemoDatenNeu('stadtfest');
    await entferneDemoDaten('starkregen');
    expect(gesehen).toEqual([
      'GET /api/demo-daten',
      'POST /api/demo-daten/stadtfest',
      'POST /api/demo-daten/stadtfest/neu',
      'DELETE /api/demo-daten/starkregen',
    ]);
  });

  it('reicht einen 409 als ApiError mit Servertext durch', async () => {
    server.use(
      http.post('/api/demo-daten/starkregen', () =>
        HttpResponse.json({ error: 'Demo-Daten sind bereits importiert' }, { status: 409 }),
      ),
    );
    const fehler = await importiereDemoDaten('starkregen').catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(ApiError);
    expect((fehler as ApiError).status).toBe(409);
    expect((fehler as ApiError).message).toBe('Demo-Daten sind bereits importiert');
  });
});
