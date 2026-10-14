import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import {
  createEinheitVorlage,
  loadEinheitVorlagen,
  replaceVorlageFahrzeuge,
  replaceVorlagePersonal,
  updateEinheitVorlage,
} from './einheitVorlagen';

describe('api/einheitVorlagen (LLH-1042)', () => {
  it('trifft Methode, Pfad und Body jedes Wegs', async () => {
    const seen: string[] = [];
    const record = async ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      const body = request.method === 'GET' ? '' : ` ${await request.text()}`;
      seen.push(`${request.method} ${url.pathname}${url.search}${body}`);
      return HttpResponse.json(request.method === 'GET' ? [] : {});
    };
    server.use(
      http.get('/api/einheit-vorlagen', record),
      http.post('/api/einheit-vorlagen', record),
      http.patch('/api/einheit-vorlagen/:id', record),
      http.put('/api/einheit-vorlagen/:id/fahrzeuge', record),
      http.put('/api/einheit-vorlagen/:id/personal', record),
    );

    await loadEinheitVorlagen('aktiv');
    await loadEinheitVorlagen('alle');
    await createEinheitVorlage({ name: 'SEG', typ_id: 3, ueber_vorlage_id: null });
    await updateEinheitVorlage(7, { ueber_vorlage_id: null, aktiv: false });
    await replaceVorlageFahrzeuge(7, [4, 2]);
    await replaceVorlagePersonal(7, [
      { personal_id: 9, fahrzeug_id: 4, staerke_position: 'fuehrer' },
    ]);

    expect(seen).toEqual([
      'GET /api/einheit-vorlagen',
      'GET /api/einheit-vorlagen?nur_aktive=false',
      'POST /api/einheit-vorlagen {"name":"SEG","typ_id":3,"ueber_vorlage_id":null}',
      // `null` heißt beim PATCH „Wurzel“ und muss auf dem Draht stehen bleiben.
      'PATCH /api/einheit-vorlagen/7 {"ueber_vorlage_id":null,"aktiv":false}',
      'PUT /api/einheit-vorlagen/7/fahrzeuge {"fahrzeug_ids":[4,2]}',
      'PUT /api/einheit-vorlagen/7/personal {"personal":[{"personal_id":9,"fahrzeug_id":4,"staerke_position":"fuehrer"}]}',
    ]);
  });
});
