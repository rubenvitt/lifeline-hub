import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { gruendeJeKraft } from '../kraefte/sammelDisposition';
import { zuordnenBesatzungMenge } from './einsatzFahrzeuge';

describe('api/einsatzFahrzeuge — Besatzung in einem Schritt (LLH-1073, design.md D12)', () => {
  it('trifft Methode, Pfad und Body', async () => {
    const seen: string[] = [];
    server.use(
      http.post('/api/einsaetze/:id/fahrzeuge/:efId/besatzung', async ({ request }) => {
        seen.push(`POST ${new URL(request.url).pathname} ${await request.text()}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await zuordnenBesatzungMenge(5, 3, [7, 8]);
    expect(seen).toEqual(['POST /api/einsaetze/5/fahrzeuge/3/besatzung {"ep_ids":[7,8]}']);
  });

  it('liefert die Gründe je Person aus `zeilen`', async () => {
    server.use(
      http.post('/api/einsaetze/:id/fahrzeuge/:efId/besatzung', () =>
        HttpResponse.json(
          {
            error: 'Nicht alle Personen lassen sich zuordnen',
            zeilen: [{ art: 'personal', id: 8, grund: 'entlassen' }],
          },
          { status: 422 },
        ),
      ),
    );
    const fehler = await zuordnenBesatzungMenge(5, 3, [7, 8]).catch((e: unknown) => e);
    expect(gruendeJeKraft(fehler, 'personal')).toEqual(new Map([[8, 'entlassen']]));
  });
});
