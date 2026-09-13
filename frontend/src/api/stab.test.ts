import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { ladeLagebesprechungen, schliesseLagebesprechungAb } from './stab';

const antwort = { anzahl_lagebesprechungen: 1, besetzung: [] };

/**
 * Der Tri-State von `naechste_at` muss den DRAHT erreichen: `JSON.stringify` lässt einen
 * fehlenden Schlüssel weg und schreibt `null` aus. Geprüft wird, was der Server bekommt.
 */
describe('schliesseLagebesprechungAb', () => {
  function faengeBody() {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/einsaetze/1/stab/lagebesprechungen', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(antwort, { status: 201 });
      }),
    );
    return bodies;
  }

  it('ohne Schlüssel kommt kein naechste_at an', async () => {
    const bodies = faengeBody();
    await schliesseLagebesprechungAb(1, { entschluss: 'x', abgehalten_at: '2026-09-13 10:00:00' });
    expect(Object.keys(bodies[0])).not.toContain('naechste_at');
  });

  it('null kommt als null an (Gegenfall)', async () => {
    const bodies = faengeBody();
    await schliesseLagebesprechungAb(1, { entschluss: 'x', naechste_at: null });
    expect(bodies[0]).toHaveProperty('naechste_at', null);
  });

  it('liefert die StabAnzeige der 201-Antwort', async () => {
    faengeBody();
    await expect(schliesseLagebesprechungAb(1, { entschluss: 'x' })).resolves.toEqual(antwort);
  });
});

describe('ladeLagebesprechungen', () => {
  it('liest die Historie', async () => {
    server.use(
      http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([{ id: 3 }])),
    );
    await expect(ladeLagebesprechungen(1)).resolves.toEqual([{ id: 3 }]);
  });
});
