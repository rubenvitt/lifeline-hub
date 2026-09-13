import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { starteRegionBau, ladeBaubareRegionen, ladeBauStatus } from './offlineKarten';

describe('starteRegionBau', () => {
  it('postet den slug an /api/karte/offline-karten/bauen und liefert die job_id', async () => {
    let gesehen: unknown;
    server.use(
      http.post('/api/karte/offline-karten/bauen', async ({ request }) => {
        gesehen = await request.json();
        return HttpResponse.json({ job_id: 7 });
      }),
    );
    const r = await starteRegionBau('bayern');
    expect(r.job_id).toBe(7);
    expect(gesehen).toEqual({ slug: 'bayern' });
  });
});

describe('ladeBauStatus', () => {
  it('parst die Job-Liste mit verschachteltem status-Objekt', async () => {
    server.use(
      http.get('/api/karte/offline-karten/bau-status', () =>
        HttpResponse.json([
          {
            id: 1,
            slug: 'bayern',
            status: { status: 'building' },
            gestartet: '2026-01-01T00:00:00Z',
            beendet: null,
          },
        ]),
      ),
    );
    const jobs = await ladeBauStatus();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status.status).toBe('building');
  });

  it('parst einen fehlgeschlagenen Job inkl. fehler-Text', async () => {
    server.use(
      http.get('/api/karte/offline-karten/bau-status', () =>
        HttpResponse.json([
          {
            id: 2,
            slug: 'sachsen',
            status: { status: 'failed', fehler: 'Timeout beim Upload' },
            gestartet: '2026-01-01T00:00:00Z',
            beendet: '2026-01-01T00:05:00Z',
          },
        ]),
      ),
    );
    const jobs = await ladeBauStatus();
    const status = jobs[0].status;
    expect(status.status).toBe('failed');
    // Union-Narrowing (LFH-323): `fehler` existiert nur auf dem failed-Zweig der diskriminierten
    // Union — das `throw` narrowt für TS und lässt den Test laut scheitern, wenn nicht failed.
    if (status.status !== 'failed') throw new Error('Job sollte failed sein');
    expect(status.fehler).toBe('Timeout beim Upload');
  });
});

describe('ladeBaubareRegionen', () => {
  it('parst die Liste baubarer Regionen', async () => {
    server.use(
      http.get('/api/karte/offline-karten/baubare-regionen', () =>
        HttpResponse.json([
          { slug: 'bayern', name: 'Bayern', region: 'DE-BY', gruppe: 'Bundesländer' },
        ]),
      ),
    );
    await expect(ladeBaubareRegionen()).resolves.toEqual([
      { slug: 'bayern', name: 'Bayern', region: 'DE-BY', gruppe: 'Bundesländer' },
    ]);
  });
});
