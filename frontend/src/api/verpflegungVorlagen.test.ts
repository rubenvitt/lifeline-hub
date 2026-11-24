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
      http.get('/api/catering-templates', record),
      http.post('/api/catering-templates', record),
      http.patch('/api/catering-templates/:id', record),
      http.post('/api/einsaetze/:id/catering/time-slots/from-template', record),
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
      'GET /api/catering-templates',
      'GET /api/catering-templates?nur_aktive=false',
      'POST /api/catering-templates {"bezeichnung":"Frühstück","beginn":"06:30","ende":"08:00"}',
      // `null` leert die Art und muss auf dem Draht stehen bleiben.
      'PATCH /api/catering-templates/4 {"verpflegungsart":null,"aktiv":false}',
      'POST /api/einsaetze/7/catering/time-slots/from-template {"tag_von_at":"2026-10-10 22:00:00","tag_bis_at":"2026-10-11 22:00:00","zeitfenster":[{"bezeichnung":"Frühstück","von_at":"2026-10-11 04:30:00","bis_at":"2026-10-11 06:00:00","bedarf_kraefte":180,"bedarf_betreute":70}]}',
    ]);
  });
});
