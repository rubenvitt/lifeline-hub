import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import {
  aendereBezirk,
  aendereStelle,
  ladeBelegungKopfzahl,
  ladeBetreuung,
  legeBezirkAn,
  legeStelleAn,
  meldeBelegung,
  meldeStand,
  nimmBelegungZurueck,
  nimmStandZurueck,
  storniereBezirk,
  storniereStelle,
} from './betreuung';

/**
 * Client des Fachmoduls Betreuung (LFH-639). Geprüft wird, was beim Server ANKOMMT — Pfad,
 * Methode, Query und Body —, nicht das Objekt davor: `JSON.stringify` verschluckt einen
 * `undefined`-Schlüssel, und genau dort entsteht der Unterschied zwischen „leeren" und
 * „nicht anfassen" (Muster `stab.test.ts`, `patchTriState.test.ts`).
 */

interface Anfrage {
  methode: string;
  pfad: string;
  query: string;
  body: unknown;
}

const B = '/api/einsaetze/7/betreuung';

/** Fängt jede Anfrage unter dem Modulpfad und antwortet mit `{ ok: true }`. */
function faengeAnfragen(): Anfrage[] {
  const anfragen: Anfrage[] = [];
  const antwort = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.text();
    anfragen.push({
      methode: request.method,
      pfad: url.pathname,
      query: url.search,
      body: text ? JSON.parse(text) : undefined,
    });
    return HttpResponse.json({ ok: true });
  };
  server.use(http.all(`${B}`, antwort), http.all(`${B}/*`, antwort));
  return anfragen;
}

describe('api/betreuung — Pfade und Methoden der zwölf Endpunkte', () => {
  it('liest Übersicht und Kopfzahl', async () => {
    const a = faengeAnfragen();
    await ladeBetreuung(7);
    await ladeBelegungKopfzahl(7);
    expect(a.map((x) => [x.methode, x.pfad, x.query])).toEqual([
      ['GET', B, ''],
      ['GET', `${B}/belegung`, ''],
    ]);
  });

  it('kodiert den Stichtag der Kopfzahl — der Wire-String trägt ein Leerzeichen', async () => {
    const a = faengeAnfragen();
    await ladeBelegungKopfzahl(7, '2026-09-23 12:00:00');
    // Round-Trip durch URLSearchParams statt Pin auf den rohen Pfad: entscheidend ist, was
    // der Server als Wert liest, nicht wie das Leerzeichen kodiert ist.
    expect(new URLSearchParams(a[0].query).get('zeitpunkt')).toBe('2026-09-23 12:00:00');
  });

  it('kodiert auch einen Stichtag mit Zonenversatz — ein rohes `+` käme als Leerzeichen an', async () => {
    const a = faengeAnfragen();
    await ladeBelegungKopfzahl(7, '2026-09-23T14:00:00+02:00');
    expect(new URLSearchParams(a[0].query).get('zeitpunkt')).toBe('2026-09-23T14:00:00+02:00');
  });

  it('schreibt Bezirke, Stände und ihre Rücknahme an die richtigen Pfade', async () => {
    const a = faengeAnfragen();
    await legeBezirkAn(7, {
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 640,
      plan_erhebung: 'geschaetzt',
    });
    await aendereBezirk(7, 3, { raeumung: 'geraeumt' });
    await storniereBezirk(7, 3);
    await meldeStand(7, 3, { evakuiert: 212, erhebung: 'gezaehlt' });
    await nimmStandZurueck(7, 11);
    expect(a.map((x) => [x.methode, x.pfad])).toEqual([
      ['POST', `${B}/bezirke`],
      ['PATCH', `${B}/bezirke/3`],
      ['POST', `${B}/bezirke/3/stornieren`],
      ['POST', `${B}/bezirke/3/staende`],
      ['POST', `${B}/staende/11/zuruecknehmen`],
    ]);
    expect(a[0].body).toEqual({
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 640,
      plan_erhebung: 'geschaetzt',
    });
    expect(a[3].body).toEqual({ evakuiert: 212, erhebung: 'gezaehlt' });
  });

  it('schreibt Stellen, Belegungen und ihre Rücknahme an die richtigen Pfade', async () => {
    const a = faengeAnfragen();
    await legeStelleAn(7, {
      bezeichnung: 'Turnhalle Ost',
      art: 'notunterkunft',
      kapazitaet_personen: 150,
    });
    await aendereStelle(7, 4, { status: 'in_betrieb' });
    await storniereStelle(7, 4);
    await meldeBelegung(7, 4, { belegt: 89, zeitpunkt_at: '2026-09-23 12:00:00' });
    await nimmBelegungZurueck(7, 21);
    expect(a.map((x) => [x.methode, x.pfad])).toEqual([
      ['POST', `${B}/stellen`],
      ['PATCH', `${B}/stellen/4`],
      ['POST', `${B}/stellen/4/stornieren`],
      ['POST', `${B}/stellen/4/belegungen`],
      ['POST', `${B}/belegungen/21/zuruecknehmen`],
    ]);
    expect(a[3].body).toEqual({ belegt: 89, zeitpunkt_at: '2026-09-23 12:00:00' });
  });
});

describe('api/betreuung — PATCH ist dreiwertig am Draht', () => {
  it('ein fehlender Schlüssel kommt nicht an, `null` kommt als `null` an (Bezirk)', async () => {
    const a = faengeAnfragen();
    await aendereBezirk(7, 3, { plan_personen: 820 });
    await aendereBezirk(7, 3, { sammelstelle: null, abschnitt_id: null });
    expect(Object.keys(a[0].body as object)).toEqual(['plan_personen']);
    expect(a[1].body).toEqual({ sammelstelle: null, abschnitt_id: null });
  });

  it('`kapazitaet_personen: null` heißt „keine Kapazität mehr" und erreicht den Server (Stelle)', async () => {
    const a = faengeAnfragen();
    await aendereStelle(7, 4, { kapazitaet_personen: null });
    expect(a[0].body).toEqual({ kapazitaet_personen: null });
  });
});
