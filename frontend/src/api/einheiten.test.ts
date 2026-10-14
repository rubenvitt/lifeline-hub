import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { createEinheitAusVorlage, loadEinheitAusVorlage, patchEinheitZeichen } from './einheiten';

describe('api/einheiten — Einheit aus Vorlage (LLH-1049)', () => {
  it('trifft Methode, Pfad und Body von Vorschau und Bilden', async () => {
    const seen: string[] = [];
    server.use(
      http.get('/api/einsaetze/:id/einheiten/aus-vorlage/:vorlageId', ({ request }) => {
        seen.push(`GET ${new URL(request.url).pathname}`);
        return HttpResponse.json({
          vorlage_id: 3,
          knoten: [],
          fahrzeuge_gesperrt: false,
          personal_gesperrt: false,
        });
      }),
      http.post('/api/einsaetze/:id/einheiten/aus-vorlage', async ({ request }) => {
        seen.push(`POST ${new URL(request.url).pathname} ${await request.text()}`);
        return HttpResponse.json(
          { einheit_id: 11, einheit_ids: [11, 12], fahrzeuge: [], personal: [] },
          { status: 201 },
        );
      }),
    );

    const vorschau = await loadEinheitAusVorlage(5, 3);
    const ergebnis = await createEinheitAusVorlage(5, {
      vorlage_id: 3,
      name: '1. Zug',
      abschnitt_id: null,
      fahrzeuge: [{ fahrzeug_id: 4, umhaengen: true }],
      personal: [{ personal_id: 9, umhaengen: false }],
    });

    expect(vorschau.vorlage_id).toBe(3);
    expect(ergebnis.einheit_id).toBe(11);
    expect(seen).toEqual([
      'GET /api/einsaetze/5/einheiten/aus-vorlage/3',
      'POST /api/einsaetze/5/einheiten/aus-vorlage {"vorlage_id":3,"name":"1. Zug","abschnitt_id":null,"fahrzeuge":[{"fahrzeug_id":4,"umhaengen":true}],"personal":[{"personal_id":9,"umhaengen":false}]}',
    ]);
  });
});

/**
 * Das taktische Zeichen aus der Einheit-Ansicht (LLH-1036, design.md D4): genau EIN Zeichenfeld an
 * den Lageweg `…/position`, nie eine Koordinate — sonst verschöbe oder löschte das Speichern der
 * Fachaufgabe die Verortung auf der Karte.
 */
describe('api/einheiten · patchEinheitZeichen', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{"id":10}', { status: 200 }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function aufruf(): { pfad: string; init: RequestInit } {
    const [pfad, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { pfad, init };
  }

  it('schickt nur die Fachaufgabe per PATCH an …/position', async () => {
    await patchEinheitZeichen(1, 10, { tz_fachaufgabe: 'betreuung' });
    const { pfad, init } = aufruf();
    expect(pfad).toBe('/api/einsaetze/1/einheiten/10/position');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ tz_fachaufgabe: 'betreuung' });
  });

  it('schickt nur die Organisation, geleert als `null`', async () => {
    await patchEinheitZeichen(1, 10, { tz_organisation: null });
    expect(JSON.parse(aufruf().init.body as string)).toEqual({ tz_organisation: null });
  });

  it('lässt aus einem breiteren Objekt nichts anderes durch, auch keine Koordinate', async () => {
    const breit = { tz_fachaufgabe: 'fuehrung', lat: 52.1, lon: 10.2 } as never;
    await patchEinheitZeichen(1, 10, breit);
    expect(JSON.parse(aufruf().init.body as string)).toEqual({ tz_fachaufgabe: 'fuehrung' });
  });
});
