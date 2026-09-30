import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import {
  aendereMedienkontakt,
  aktualisierePressemitteilung,
  gibPressemitteilungFrei,
  ladeMedienkontakte,
  ladePressemitteilung,
  ladePressemitteilungen,
  legeMedienkontaktAn,
  legePressemitteilungAn,
  schreibePressemitteilungFort,
  setzeMedienkontaktStatus,
} from './presse';
import { erfasseAnruf, ladeAnrufe, setzeAnrufStatus } from './infotelefon';

/**
 * Clients der Presse- und Medienarbeit S5 (LFH-554). Geprüft wird, was beim Server ANKOMMT —
 * Pfad, Methode, Body (Muster `verpflegung.test.ts`).
 */

interface Anfrage {
  methode: string;
  pfad: string;
  body: unknown;
}

const B = '/api/einsaetze/7/stab';

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
    return HttpResponse.json({ ok: true });
  };
  server.use(http.all(`${B}/*`, antwort));
  return anfragen;
}

describe('api/presse — Presse-Log', () => {
  it('liest, legt an, ändert und setzt den Status an den richtigen Pfaden', async () => {
    const a = faengeAnfragen();
    await ladeMedienkontakte(7);
    await legeMedienkontaktAn(7, { art: 'anfrage', medium: 'NDR 1', thema: 'Evakuierte' });
    await aendereMedienkontakt(7, 3, { kontakt_name: null });
    await setzeMedienkontaktStatus(7, 3, { status: 'beantwortet', antwort: '240' });
    expect(a).toEqual([
      { methode: 'GET', pfad: `${B}/medienkontakte`, body: undefined },
      {
        methode: 'POST',
        pfad: `${B}/medienkontakte`,
        body: { art: 'anfrage', medium: 'NDR 1', thema: 'Evakuierte' },
      },
      // `null` leert — es muss beim Server ankommen, nicht verschluckt werden.
      { methode: 'PATCH', pfad: `${B}/medienkontakte/3`, body: { kontakt_name: null } },
      {
        methode: 'POST',
        pfad: `${B}/medienkontakte/3/status`,
        body: { status: 'beantwortet', antwort: '240' },
      },
    ]);
  });
});

describe('api/presse — Pressemitteilungen', () => {
  it('bedient Liste, Detail, Anlegen, Bearbeiten, Freigabe und Fortschreiben', async () => {
    const a = faengeAnfragen();
    await ladePressemitteilungen(7);
    await ladePressemitteilung(7, 4);
    await legePressemitteilungAn(7, { vorlage: 'erstinformation', titel: 'Hochwasser' });
    await aktualisierePressemitteilung(7, 4, { titel: 'neu' });
    await gibPressemitteilungFrei(7, 4);
    await schreibePressemitteilungFort(7, 4);
    expect(a.map((x) => [x.methode, x.pfad])).toEqual([
      ['GET', `${B}/pressemitteilungen`],
      ['GET', `${B}/pressemitteilungen/4`],
      ['POST', `${B}/pressemitteilungen`],
      ['PATCH', `${B}/pressemitteilungen/4`],
      ['POST', `${B}/pressemitteilungen/4/freigeben`],
      ['POST', `${B}/pressemitteilungen/4/fortschreiben`],
    ]);
  });
});

describe('api/infotelefon', () => {
  it('liest, erfasst und setzt den Rückrufstatus', async () => {
    const a = faengeAnfragen();
    await ladeAnrufe(7);
    await erfasseAnruf(7, { anliegen: 'hinweis', rueckruf: '0171', rueckruf_noetig: true });
    await setzeAnrufStatus(7, 9, 'erledigt');
    expect(a).toEqual([
      { methode: 'GET', pfad: `${B}/infotelefon`, body: undefined },
      {
        methode: 'POST',
        pfad: `${B}/infotelefon`,
        body: { anliegen: 'hinweis', rueckruf: '0171', rueckruf_noetig: true },
      },
      { methode: 'POST', pfad: `${B}/infotelefon/9/status`, body: { status: 'erledigt' } },
    ]);
  });
});
