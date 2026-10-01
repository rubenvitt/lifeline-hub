import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { sucheOrt } from './karteOrtSuche';

/**
 * Client der Adresssuche (LFH-638). Geprüft wird, was beim Server ANKOMMT: der Suchtext ist frei
 * getippt (Leerzeichen, Komma, Umlaute, `&`) und muss als EIN Parameter `q` ankommen.
 */
describe('sucheOrt', () => {
  it('schickt den Suchtext kodiert als q an die Route der Lagekarte', async () => {
    let angekommen: URL | null = null;
    server.use(
      http.get('/api/einsaetze/7/karte/ort-suche', ({ request }) => {
        angekommen = new URL(request.url);
        return HttpResponse.json({ zustand: 'ok', treffer: [] });
      }),
    );
    const antwort = await sucheOrt(7, 'Hauptstraße 12 & Ecke, Musterstadt');
    expect(antwort).toEqual({ zustand: 'ok', treffer: [] });
    expect(angekommen!.searchParams.getAll('q')).toEqual(['Hauptstraße 12 & Ecke, Musterstadt']);
    expect([...angekommen!.searchParams.keys()]).toEqual(['q']);
  });
});
