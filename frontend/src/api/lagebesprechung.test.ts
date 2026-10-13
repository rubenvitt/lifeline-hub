import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import {
  fetchLagebesprechungen,
  fetchLagebesprechungStand,
  lagebesprechungAbschliessen,
  setLagebesprechungTermin,
} from './lagebesprechung';

const antwort = { anzahl_lagebesprechungen: 1 };

/**
 * Der Tri-State von `naechste_at` muss den DRAHT erreichen: `JSON.stringify` lässt einen
 * fehlenden Schlüssel weg und schreibt `null` aus. Geprüft wird, was der Server bekommt.
 */
describe('lagebesprechungAbschliessen', () => {
  function faengeBody() {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/einsaetze/1/lagebesprechungen', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(antwort, { status: 201 });
      }),
    );
    return bodies;
  }

  it('ohne Schlüssel kommt kein naechste_at an', async () => {
    const bodies = faengeBody();
    await lagebesprechungAbschliessen(1, {
      entschluss: 'x',
      abgehalten_at: '2026-09-13 10:00:00',
    });
    expect(Object.keys(bodies[0])).not.toContain('naechste_at');
  });

  it('null kommt als null an (Gegenfall)', async () => {
    const bodies = faengeBody();
    await lagebesprechungAbschliessen(1, { entschluss: 'x', naechste_at: null });
    expect(bodies[0]).toHaveProperty('naechste_at', null);
  });

  it('liefert den Stand der 201-Antwort', async () => {
    faengeBody();
    await expect(lagebesprechungAbschliessen(1, { entschluss: 'x' })).resolves.toEqual(antwort);
  });
});

describe('setLagebesprechungTermin', () => {
  it('schickt den Termin per PUT, null als null', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put('/api/einsaetze/1/lagebesprechung/termin', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(antwort);
      }),
    );
    await setLagebesprechungTermin(1, { naechste_at: '2026-09-13 11:00:00' });
    await setLagebesprechungTermin(1, { naechste_at: null });
    expect(bodies).toEqual([{ naechste_at: '2026-09-13 11:00:00' }, { naechste_at: null }]);
  });
});

describe('Lesen', () => {
  it('liest Stand und Verlauf unter dem Modulpfad', async () => {
    server.use(
      http.get('/api/einsaetze/1/lagebesprechung', () => HttpResponse.json(antwort)),
      http.get('/api/einsaetze/1/lagebesprechungen', () => HttpResponse.json([{ id: 3 }])),
    );
    await expect(fetchLagebesprechungStand(1)).resolves.toEqual(antwort);
    await expect(fetchLagebesprechungen(1)).resolves.toEqual([{ id: 3 }]);
  });
});
