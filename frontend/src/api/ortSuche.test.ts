import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { sucheOrtImEinsatz, sucheOrtInOrg } from './ortSuche';

/**
 * Client der Ortssuche des Ortsfelds (LFH-1175, Spec `ortsfeld`). Geprüft wird, was beim Server
 * ANKOMMT: der frei getippte Suchtext als EIN Parameter `q`, an der Route ohne Lagekarten-Gate.
 */
describe('Ortssuche des Ortsfelds', () => {
  it('sucht im Einsatz an der Route ohne /karte', async () => {
    let angekommen: URL | null = null;
    server.use(
      http.get('/api/einsaetze/7/ort-suche', ({ request }) => {
        angekommen = new URL(request.url);
        return HttpResponse.json({ zustand: 'ok', treffer: [] });
      }),
    );
    const antwort = await sucheOrtImEinsatz(7, 'Hauptstraße 12 & Ecke, Musterstadt');
    expect(antwort).toEqual({ zustand: 'ok', treffer: [] });
    expect(angekommen!.searchParams.getAll('q')).toEqual(['Hauptstraße 12 & Ecke, Musterstadt']);
    expect([...angekommen!.searchParams.keys()]).toEqual(['q']);
  });

  it('sucht ohne Einsatz an der Route der Organisation', async () => {
    let angekommen: URL | null = null;
    server.use(
      http.get('/api/ort-suche', ({ request }) => {
        angekommen = new URL(request.url);
        return HttpResponse.json({ zustand: 'ausgelastet', treffer: [] });
      }),
    );
    const antwort = await sucheOrtInOrg('Bahnhofstraße 1');
    expect(antwort.zustand).toBe('ausgelastet');
    expect(angekommen!.searchParams.getAll('q')).toEqual(['Bahnhofstraße 1']);
  });
});
