import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { fetchEinsatzSchichtmodell, setEinsatzSchichtmodell } from './abloesungen';
import {
  createSchichtmodell,
  deleteSchichtmodell,
  fetchSchichtmodelle,
  setOrgVorgabe,
  updateSchichtmodell,
  werteBodyOf,
} from './schichtmodelle';
import type { Schichtmodell } from './types';

const modell = (over: Partial<Schichtmodell> & { id: number }): Schichtmodell => ({
  bezeichnung: `Modell ${over.id}`,
  typ: 'rhythmus',
  rhythmus_minuten: 720,
  vorwarnung_minuten: 30,
  planungsvorlauf_minuten: 120,
  ist_vorgabe: false,
  ist_demo: false,
  ...over,
});

/** Zeichnet jede Anfrage als „METHODE /pfad body“ auf; `ablehnen` antwortet für einen Pfad 409. */
function aufzeichnen(ablehnen?: { methode: string; pfad: string }) {
  const seen: string[] = [];
  const record = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const text = await request.text();
    seen.push(`${request.method} ${url.pathname}${text ? ` ${text}` : ''}`);
    if (ablehnen && request.method === ablehnen.methode && url.pathname === ablehnen.pfad) {
      return HttpResponse.json({ error: 'zweite Vorgabe' }, { status: 409 });
    }
    if (request.method === 'DELETE') return new HttpResponse(null, { status: 204 });
    return HttpResponse.json(request.method === 'GET' ? [] : {});
  };
  server.use(
    http.get('/api/schichtmodelle', record),
    http.post('/api/schichtmodelle', record),
    http.put('/api/schichtmodelle/:id', record),
    http.delete('/api/schichtmodelle/:id', record),
    http.get('/api/einsaetze/:id/abloesungen/schichtmodell', record),
    http.put('/api/einsaetze/:id/abloesungen/schichtmodell', record),
  );
  return seen;
}

describe('api/schichtmodelle (LLH-1122)', () => {
  it('trifft Methode, Pfad und Body jedes Wegs', async () => {
    const seen = aufzeichnen();
    await fetchSchichtmodelle();
    await createSchichtmodell({
      bezeichnung: 'Hochwasser',
      typ: 'wechselzeiten',
      wechselzeiten: ['06:00', '18:00'],
      mindestdauer_minuten: 240,
      ist_vorgabe: false,
    });
    await updateSchichtmodell(3, {
      bezeichnung: 'SanD',
      typ: 'rhythmus',
      rhythmus_minuten: 360,
      ist_vorgabe: true,
    });
    await deleteSchichtmodell(3);
    await fetchEinsatzSchichtmodell(7);
    await setEinsatzSchichtmodell(7, { schichtmodell_id: 3 });
    // `null` heißt „entfernen“ und muss auf dem Draht stehen bleiben.
    await setEinsatzSchichtmodell(7, { schichtmodell: null });
    expect(seen).toEqual([
      'GET /api/schichtmodelle',
      'POST /api/schichtmodelle {"bezeichnung":"Hochwasser","typ":"wechselzeiten","wechselzeiten":["06:00","18:00"],"mindestdauer_minuten":240,"ist_vorgabe":false}',
      'PUT /api/schichtmodelle/3 {"bezeichnung":"SanD","typ":"rhythmus","rhythmus_minuten":360,"ist_vorgabe":true}',
      'DELETE /api/schichtmodelle/3',
      'GET /api/einsaetze/7/abloesungen/schichtmodell',
      'PUT /api/einsaetze/7/abloesungen/schichtmodell {"schichtmodell_id":3}',
      'PUT /api/einsaetze/7/abloesungen/schichtmodell {"schichtmodell":null}',
    ]);
  });

  it('schickt nur die Felder des Typs (ein Feld des anderen Typs wäre 422)', () => {
    expect(
      werteBodyOf(
        modell({
          id: 1,
          typ: 'wechselzeiten',
          rhythmus_minuten: null,
          wechselzeiten: ['06:00', '18:00'],
          mindestdauer_minuten: 240,
        }),
      ),
    ).toEqual({
      bezeichnung: 'Modell 1',
      typ: 'wechselzeiten',
      wechselzeiten: ['06:00', '18:00'],
      mindestdauer_minuten: 240,
      vorwarnung_minuten: 30,
      planungsvorlauf_minuten: 120,
    });
    expect(Object.keys(werteBodyOf(modell({ id: 2 })))).not.toContain('mindestdauer_minuten');
  });
});

describe('setOrgVorgabe — Wechsel in zwei Schritten (LLH-1122)', () => {
  const bisherige = modell({ id: 1, ist_vorgabe: true, bezeichnung: 'Alt' });
  const ziel = modell({ id: 2, bezeichnung: 'Neu' });

  it('hebt erst die bisherige Vorgabe auf, dann setzt es das Ziel', async () => {
    const seen = aufzeichnen();
    await setOrgVorgabe(ziel, true, bisherige);
    expect(seen.map((z) => z.replace(/ \{.*"ist_vorgabe":(\w+)\}$/, ' $1'))).toEqual([
      'PUT /api/schichtmodelle/1 false',
      'PUT /api/schichtmodelle/2 true',
    ]);
  });

  it('setzt ohne bisherige Vorgabe nur das Ziel', async () => {
    const seen = aufzeichnen();
    await setOrgVorgabe(ziel, true, undefined);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^PUT \/api\/schichtmodelle\/2 .*"ist_vorgabe":true/);
  });

  it('hebt die eigene Vorgabe in einem Schritt auf', async () => {
    const seen = aufzeichnen();
    await setOrgVorgabe(bisherige, false, bisherige);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^PUT \/api\/schichtmodelle\/1 .*"ist_vorgabe":false/);
  });

  it('stellt die bisherige Vorgabe wieder her, wenn der zweite Schritt scheitert', async () => {
    const seen = aufzeichnen({ methode: 'PUT', pfad: '/api/schichtmodelle/2' });
    await expect(setOrgVorgabe(ziel, true, bisherige)).rejects.toThrow();
    expect(seen.map((z) => z.replace(/ \{.*"ist_vorgabe":(\w+)\}$/, ' $1'))).toEqual([
      'PUT /api/schichtmodelle/1 false',
      'PUT /api/schichtmodelle/2 true',
      'PUT /api/schichtmodelle/1 true',
    ]);
  });
});
