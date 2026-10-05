import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { ApiError } from './client';
import {
  aendereBereich,
  aendereKomponente,
  aendereSkizzenVerbindung,
  entferneBereich,
  entferneKomponente,
  entferneSkizzenVerbindung,
  ladeFernmeldeskizze,
  legeBereichAn,
  legeKomponenteAn,
  legeSkizzenVerbindungAn,
  loeseSprechgruppe,
  ordneSprechgruppeZu,
  setzeSchriftfeld,
  setzeSkizzenLage,
  verwerfeSkizzenLage,
} from './fernmeldeskizze';

/**
 * Client der taktischen Fernmeldeskizze (LFH-893, Vertrag D14). Geprüft wird, was beim Server
 * ANKOMMT — Pfad, Methode, Body (Muster `presse.test.ts`).
 */

interface Anfrage {
  methode: string;
  pfad: string;
  body: unknown;
}

const E = '/api/einsaetze/7';
const S = `${E}/stab/fernmeldeskizze`;

function faengeAnfragen(): Anfrage[] {
  const anfragen: Anfrage[] = [];
  const antwort = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.text();
    anfragen.push({
      methode: request.method,
      pfad: decodeURIComponent(url.pathname),
      body: text ? JSON.parse(text) : undefined,
    });
    return request.method === 'DELETE' || request.method === 'PUT'
      ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json({ ok: true });
  };
  server.use(http.all(`${E}/*`, antwort));
  return anfragen;
}

describe('api/fernmeldeskizze — Skizzendaten', () => {
  it('liest, verschiebt mit erwarteter Version und ordnet neu an', async () => {
    const a = faengeAnfragen();
    await ladeFernmeldeskizze(7);
    await setzeSkizzenLage(7, 'ab-3', { x: 16, y: 24, version: null });
    await setzeSkizzenLage(7, 'sg-9', { x: 0, y: 8, breite: 320, version: 4 });
    await verwerfeSkizzenLage(7);
    expect(a).toEqual([
      { methode: 'GET', pfad: S, body: undefined },
      // `version: null` heißt „noch keine Zeile erwartet“ und muss ankommen (D14).
      { methode: 'PUT', pfad: `${S}/lage/ab-3`, body: { x: 16, y: 24, version: null } },
      { methode: 'PUT', pfad: `${S}/lage/sg-9`, body: { x: 0, y: 8, breite: 320, version: 4 } },
      { methode: 'DELETE', pfad: `${S}/lage`, body: undefined },
    ]);
  });

  it('schickt vom Schriftfeld nur die Teilfelder, `null` leert', async () => {
    const a = faengeAnfragen();
    await setzeSchriftfeld(7, { gueltig_ab: '2026-10-04T08:00:00Z', gez_name: null });
    expect(a).toEqual([
      {
        methode: 'PUT',
        pfad: `${S}/schriftfeld`,
        body: { gueltig_ab: '2026-10-04T08:00:00Z', gez_name: null },
      },
    ]);
  });

  it('bedient Komponenten samt Kanälen, Verbindungen und Bereiche', async () => {
    const a = faengeAnfragen();
    await legeKomponenteAn(7, { art: 'repeater', bezeichnung: 'RPT Nord' });
    await aendereKomponente(7, 2, { bezeichnung: null });
    await entferneKomponente(7, 2);
    await legeSkizzenVerbindungAn(7, {
      von: { art: 'fuehrungsstelle', id: null },
      nach: { art: 'stelle', id: 5 },
      art: 'daten',
      medium: 'leitung',
      status: 'geplant',
    });
    await aendereSkizzenVerbindung(7, 3, { status: 'bestehend', verkehr: null });
    await entferneSkizzenVerbindung(7, 3);
    await legeBereichAn(7, { x: 0, y: 0, breite: 400, hoehe: 200 });
    await aendereBereich(7, 4, { x: 8, version: 2 });
    await entferneBereich(7, 4);
    expect(a).toEqual([
      {
        methode: 'POST',
        pfad: `${S}/komponenten`,
        body: { art: 'repeater', bezeichnung: 'RPT Nord' },
      },
      { methode: 'PATCH', pfad: `${S}/komponenten/2`, body: { bezeichnung: null } },
      { methode: 'DELETE', pfad: `${S}/komponenten/2`, body: undefined },
      {
        methode: 'POST',
        pfad: `${S}/verbindungen`,
        body: {
          von: { art: 'fuehrungsstelle', id: null },
          nach: { art: 'stelle', id: 5 },
          art: 'daten',
          medium: 'leitung',
          status: 'geplant',
        },
      },
      {
        methode: 'PATCH',
        pfad: `${S}/verbindungen/3`,
        body: { status: 'bestehend', verkehr: null },
      },
      { methode: 'DELETE', pfad: `${S}/verbindungen/3`, body: undefined },
      { methode: 'POST', pfad: `${S}/bereiche`, body: { x: 0, y: 0, breite: 400, hoehe: 200 } },
      { methode: 'PATCH', pfad: `${S}/bereiche/4`, body: { x: 8, version: 2 } },
      { methode: 'DELETE', pfad: `${S}/bereiche/4`, body: undefined },
    ]);
  });
});

describe('api/fernmeldeskizze — Einzel-Zuordnungen (D5)', () => {
  it('setzt und löst je Ziel genau eine Zuordnung am Pfad des Datensatzes', async () => {
    const a = faengeAnfragen();
    await ordneSprechgruppeZu(7, { art: 'abschnitt', id: 1 }, 31);
    await loeseSprechgruppe(7, { art: 'abschnitt', id: 1 }, 31);
    await ordneSprechgruppeZu(7, { art: 'einheit', id: 10 }, 31);
    await loeseSprechgruppe(7, { art: 'einheit', id: 10 }, 31);
    await ordneSprechgruppeZu(7, { art: 'fuehrungsstelle' }, 31);
    await loeseSprechgruppe(7, { art: 'fuehrungsstelle' }, 31);
    await ordneSprechgruppeZu(7, { art: 'stelle', id: 5 }, 31, 'geplant');
    await loeseSprechgruppe(7, { art: 'stelle', id: 5 }, 31);
    await ordneSprechgruppeZu(7, { art: 'komponente', id: 2 }, 31);
    await loeseSprechgruppe(7, { art: 'komponente', id: 2 }, 31);
    expect(a).toEqual([
      { methode: 'PUT', pfad: `${E}/abschnitte/1/sprechgruppen/31`, body: undefined },
      { methode: 'DELETE', pfad: `${E}/abschnitte/1/sprechgruppen/31`, body: undefined },
      { methode: 'PUT', pfad: `${E}/einheiten/10/sprechgruppen/31`, body: undefined },
      { methode: 'DELETE', pfad: `${E}/einheiten/10/sprechgruppen/31`, body: undefined },
      { methode: 'PUT', pfad: `${E}/fuehrungsstelle/sprechgruppen/31`, body: undefined },
      { methode: 'DELETE', pfad: `${E}/fuehrungsstelle/sprechgruppen/31`, body: undefined },
      // Nur die externe Stelle trägt einen Status (D7); fehlt er, ist sie bestehend.
      {
        methode: 'PUT',
        pfad: `${E}/stab/kommunikationsplan/stellen/5/sprechgruppen/31`,
        body: { status: 'geplant' },
      },
      {
        methode: 'DELETE',
        pfad: `${E}/stab/kommunikationsplan/stellen/5/sprechgruppen/31`,
        body: undefined,
      },
      { methode: 'PUT', pfad: `${S}/komponenten/2/sprechgruppen/31`, body: undefined },
      { methode: 'DELETE', pfad: `${S}/komponenten/2/sprechgruppen/31`, body: undefined },
    ]);
  });

  it('schickt einer externen Stelle ohne Status „bestehend“', async () => {
    const a = faengeAnfragen();
    await ordneSprechgruppeZu(7, { art: 'stelle', id: 5 }, 31);
    expect(a[0].body).toEqual({ status: 'bestehend' });
  });

  it('reicht eine 409 beim Verschieben als ApiError weiter', async () => {
    server.use(
      http.put(`${S}/lage/:element`, () =>
        HttpResponse.json(
          { error: 'Von einem anderen Arbeitsplatz verschoben', aktuell: null },
          { status: 409 },
        ),
      ),
    );
    await expect(setzeSkizzenLage(7, 'eh-1', { x: 0, y: 0, version: 2 })).rejects.toMatchObject({
      status: 409,
    });
    await expect(setzeSkizzenLage(7, 'eh-1', { x: 0, y: 0, version: 2 })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
