import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { createTagAusVorlage } from './verpflegung';
import {
  createVerpflegungVorlage,
  listVerpflegungVorlagen,
  updateVerpflegungVorlage,
} from './verpflegungVorlagen';

describe('api/verpflegungVorlagen und Tag aus der Vorlage (LLH-1058)', () => {
  it('trifft Methode, Pfad und Body jedes Wegs', async () => {
    const seen: string[] = [];
    const record = async ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      const body = request.method === 'GET' ? '' : ` ${await request.text()}`;
      seen.push(`${request.method} ${url.pathname}${url.search}${body}`);
      return HttpResponse.json(request.method === 'GET' ? [] : {});
    };
    server.use(
      http.get('/api/verpflegung-vorlagen', record),
      http.post('/api/verpflegung-vorlagen', record),
      http.patch('/api/verpflegung-vorlagen/:id', record),
      http.post('/api/einsaetze/:id/verpflegung/zeitfenster/aus-vorlage', record),
    );

    await listVerpflegungVorlagen('aktiv');
    await listVerpflegungVorlagen('alle');
    await createVerpflegungVorlage({ bezeichnung: 'Frühstück', beginn: '06:30', ende: '08:00' });
    await updateVerpflegungVorlage(4, { verpflegungsart: null, aktiv: false });
    await createTagAusVorlage(7, {
      tag_von_at: '2026-10-10 22:00:00',
      tag_bis_at: '2026-10-11 22:00:00',
      zeitfenster: [
        {
          bezeichnung: 'Frühstück',
          von_at: '2026-10-11 04:30:00',
          bis_at: '2026-10-11 06:00:00',
          bedarf_kraefte: 180,
          bedarf_betreute: 70,
        },
      ],
    });

    expect(seen).toEqual([
      'GET /api/verpflegung-vorlagen',
      'GET /api/verpflegung-vorlagen?nur_aktive=false',
      'POST /api/verpflegung-vorlagen {"bezeichnung":"Frühstück","beginn":"06:30","ende":"08:00"}',
      // `null` leert die Art und muss auf dem Draht stehen bleiben.
      'PATCH /api/verpflegung-vorlagen/4 {"verpflegungsart":null,"aktiv":false}',
      'POST /api/einsaetze/7/verpflegung/zeitfenster/aus-vorlage {"tag_von_at":"2026-10-10 22:00:00","tag_bis_at":"2026-10-11 22:00:00","zeitfenster":[{"bezeichnung":"Frühstück","von_at":"2026-10-11 04:30:00","bis_at":"2026-10-11 06:00:00","bedarf_kraefte":180,"bedarf_betreute":70}]}',
    ]);
  });
});
