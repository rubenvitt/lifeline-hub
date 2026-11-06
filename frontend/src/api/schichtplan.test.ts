import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import {
  aendereSchichtplanBlock,
  aendereSchichtplanHelfer,
  erzeugeSchichten,
  fetchSchichtplan,
  legeSchichtplanBlockAn,
  legeSchichtplanHelferAn,
  loescheSchichtplanBlock,
  loescheSchichtplanHelfer,
  setzeSchichtplanGrenzwerte,
} from './schichtplan';

const basis = '/api/einsaetze/7/abloesungen/schichtplan';

/** Zeichnet jede Anfrage als „METHODE /pfad?query body“ auf. */
function aufzeichnen() {
  const seen: string[] = [];
  const record = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const text = await request.text();
    seen.push(`${request.method} ${url.pathname}${url.search}${text ? ` ${text}` : ''}`);
    if (request.method === 'DELETE') return new HttpResponse(null, { status: 204 });
    return HttpResponse.json({});
  };
  server.use(
    http.get(`${basis}`, record),
    http.post(`${basis}/*`, record),
    http.patch(`${basis}/*`, record),
    http.delete(`${basis}/*`, record),
  );
  return seen;
}

describe('Schichtplan-API (LLH-1552)', () => {
  it('trifft Pfade, Methoden und Bodies des Servers', async () => {
    const seen = aufzeichnen();
    await fetchSchichtplan(7);
    await legeSchichtplanBlockAn(7, {
      posten: { art: 'uhs', uhs_id: 3 },
      von: '2026-11-06 10:00:00',
      bis: '2026-11-06 12:00:00',
      personen: [{ art: 'helfer', helfer_id: 2 }],
    });
    await aendereSchichtplanBlock(7, 5, { version: 2, posten: { art: 'pause' } });
    await loescheSchichtplanBlock(7, 5, 3);
    await erzeugeSchichten(7, {
      posten: { art: 'einheit', einheit_id: 4 },
      von: '2026-11-06 14:00:00',
      bis: '2026-11-06 20:00:00',
      laenge_minuten: 120,
    });
    await setzeSchichtplanGrenzwerte(7, { max_dienst_minuten: null });
    await legeSchichtplanHelferAn(7, { name: 'Cem' });
    await aendereSchichtplanHelfer(7, 2, { telefon: null });
    await loescheSchichtplanHelfer(7, 2);
    expect(seen).toEqual([
      `GET ${basis}`,
      `POST ${basis}/bloecke {"posten":{"art":"uhs","uhs_id":3},"von":"2026-11-06 10:00:00","bis":"2026-11-06 12:00:00","personen":[{"art":"helfer","helfer_id":2}]}`,
      `PATCH ${basis}/bloecke/5 {"version":2,"posten":{"art":"pause"}}`,
      `DELETE ${basis}/bloecke/5?version=3`,
      `POST ${basis}/erzeugen {"posten":{"art":"einheit","einheit_id":4},"von":"2026-11-06 14:00:00","bis":"2026-11-06 20:00:00","laenge_minuten":120}`,
      `PATCH ${basis}/grenzwerte {"max_dienst_minuten":null}`,
      `POST ${basis}/helfer {"name":"Cem"}`,
      `PATCH ${basis}/helfer/2 {"telefon":null}`,
      `DELETE ${basis}/helfer/2`,
    ]);
  });
});
