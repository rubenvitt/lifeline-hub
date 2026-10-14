import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { createEinheitAusVorlage, loadEinheitAusVorlage } from './einheiten';

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
