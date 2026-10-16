import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import {
  aendereZeitfenster,
  createStelle,
  erfasseAusgabe,
  ladeVerpflegung,
  legeZeitfensterAn,
  loescheZeitfenster,
  nimmAusgabeZurueck,
  setStelleStatus,
  storniereStelle,
  updateStelle,
} from './verpflegung';

/**
 * Client des Fachmoduls Verpflegung (LFH-634). Geprüft wird, was beim Server ANKOMMT — Pfad,
 * Methode und Body —, nicht das Objekt davor: `JSON.stringify` verschluckt einen
 * `undefined`-Schlüssel (Muster `betreuung.test.ts`).
 */

interface Anfrage {
  methode: string;
  pfad: string;
  body: unknown;
}

const B = '/api/einsaetze/7/verpflegung';

/** Fängt jede Anfrage unter dem Modulpfad und antwortet mit `{ ok: true }` (DELETE: 204). */
function faengeAnfragen(): Anfrage[] {
  const anfragen: Anfrage[] = [];
  const antwort = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.text();
    anfragen.push({
      methode: request.method,
      pfad: url.pathname,
      body: text ? JSON.parse(text) : undefined,
    });
    if (request.method === 'DELETE') return new HttpResponse(null, { status: 204 });
    return HttpResponse.json({ ok: true });
  };
  server.use(http.all(`${B}`, antwort), http.all(`${B}/*`, antwort));
  return anfragen;
}

describe('api/verpflegung — Pfade und Methoden der sechs Endpunkte', () => {
  it('liest die Übersicht', async () => {
    const a = faengeAnfragen();
    await ladeVerpflegung(7);
    expect(a.map((x) => [x.methode, x.pfad])).toEqual([['GET', B]]);
  });

  it('schreibt Zeitfenster an die richtigen Pfade', async () => {
    const a = faengeAnfragen();
    await legeZeitfensterAn(7, {
      bezeichnung: 'Mittag',
      von_at: '2026-09-24 10:00:00',
      bis_at: '2026-09-24 11:30:00',
      bedarf_kraefte: 180,
      bedarf_betreute: 70,
      sonderkost: { vegan: 3 },
    });
    await aendereZeitfenster(7, 5, { bedarf_kraefte: 200 });
    await loescheZeitfenster(7, 5);
    expect(a.map((x) => [x.methode, x.pfad])).toEqual([
      ['POST', `${B}/zeitfenster`],
      ['PATCH', `${B}/zeitfenster/5`],
      ['DELETE', `${B}/zeitfenster/5`],
    ]);
    expect(a[0].body).toEqual({
      bezeichnung: 'Mittag',
      von_at: '2026-09-24 10:00:00',
      bis_at: '2026-09-24 11:30:00',
      bedarf_kraefte: 180,
      bedarf_betreute: 70,
      sonderkost: { vegan: 3 },
    });
    // Teiländerung: nur der gesetzte Schlüssel kommt an.
    expect(a[1].body).toEqual({ bedarf_kraefte: 200 });
  });

  it('erfasst eine Ausgabe am Zeitfenster und nimmt sie über die Ausgabe zurück', async () => {
    const a = faengeAnfragen();
    await erfasseAusgabe(7, 5, {
      menge: 60,
      ort: 'BR Nord',
      nachforderung_id: 12,
      sonderkost: { vegetarisch: 4 },
    });
    await nimmAusgabeZurueck(7, 31);
    expect(a.map((x) => [x.methode, x.pfad])).toEqual([
      ['POST', `${B}/zeitfenster/5/ausgaben`],
      ['POST', `${B}/ausgaben/31/zuruecknehmen`],
    ]);
    expect(a[0].body).toEqual({
      menge: 60,
      ort: 'BR Nord',
      nachforderung_id: 12,
      sonderkost: { vegetarisch: 4 },
    });
  });
});

describe('api/verpflegung — Verpflegungsstellen (LLH-1040)', () => {
  it('legt an, ändert, wechselt den Status und storniert an den richtigen Pfaden', async () => {
    const a = faengeAnfragen();
    await createStelle(7, {
      bezeichnung: 'Feldküche BR Sportplatz',
      art: 'feldkueche',
      standort: 'Am Sportplatz 2',
      lat: 52.37,
      lon: 9.73,
    });
    await updateStelle(7, 4, { standort: null, lat: null, lon: null });
    await setStelleStatus(7, 4, 'aktiv');
    await storniereStelle(7, 5);
    expect(a.map((x) => [x.methode, x.pfad])).toEqual([
      ['POST', `${B}/stellen`],
      ['PATCH', `${B}/stellen/4`],
      ['POST', `${B}/stellen/4/status`],
      ['DELETE', `${B}/stellen/5`],
    ]);
    expect(a[0].body).toEqual({
      bezeichnung: 'Feldküche BR Sportplatz',
      art: 'feldkueche',
      standort: 'Am Sportplatz 2',
      lat: 52.37,
      lon: 9.73,
    });
    // `null` leert und kommt als `null` an; fehlende Schlüssel bleiben weg.
    expect(a[1].body).toEqual({ standort: null, lat: null, lon: null });
    expect(a[2].body).toEqual({ status: 'aktiv' });
    expect(a[3].body).toBeUndefined();
  });

  it('schickt Art und Stellen des Zeitfensters und die Stelle der Ausgabe', async () => {
    const a = faengeAnfragen();
    await aendereZeitfenster(7, 5, { verpflegungsart: null, stelle_ids: [] });
    await erfasseAusgabe(7, 5, { menge: 40, verpflegungsstelle_id: 4 });
    expect(a[0].body).toEqual({ verpflegungsart: null, stelle_ids: [] });
    expect(a[1].body).toEqual({ menge: 40, verpflegungsstelle_id: 4 });
  });
});
