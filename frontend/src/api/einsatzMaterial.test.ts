import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { disponiereAdhoc, disponiereMaterial, verknuepfeNachforderung } from './einsatzMaterial';

/** Fängt den Körper des Material-POST ab. */
function faengeKoerper(): unknown[] {
  const koerper: unknown[] = [];
  server.use(
    http.post('/api/einsaetze/:id/material', async ({ request }) => {
      koerper.push(await request.json());
      return HttpResponse.json({ id: 1 }, { status: 201 });
    }),
  );
  return koerper;
}

describe('api/einsatzMaterial — Übernahme aus einer Nachforderung (LLH-1226 D1, D3)', () => {
  it('Ad-hoc mit Bezug sendet nachforderung_id, ohne ergaenzen', async () => {
    const koerper = faengeKoerper();
    await disponiereAdhoc(5, { bezeichnung: 'Tauchpumpe' }, 1, {
      art: 'geraet',
      ort: { einheit_id: 3 },
      nachforderungId: 4,
    });
    expect(koerper).toEqual([
      {
        adhoc: { bezeichnung: 'Tauchpumpe' },
        menge: 1,
        art: 'geraet',
        einheit_id: 3,
        nachforderung_id: 4,
      },
    ]);
  });

  it('bewusst ergänzen sendet ergaenzen: true neben dem Bezug', async () => {
    const koerper = faengeKoerper();
    await disponiereAdhoc(5, { bezeichnung: 'Sandsäcke' }, 800, {
      art: 'verbrauchsgut',
      nachforderungId: 4,
      ergaenzen: true,
    });
    expect(koerper).toEqual([
      {
        adhoc: { bezeichnung: 'Sandsäcke' },
        menge: 800,
        art: 'verbrauchsgut',
        nachforderung_id: 4,
        ergaenzen: true,
      },
    ]);
  });

  it('ohne Bezug bleibt der Körper wie bisher, auch beim Stamm-Material', async () => {
    const koerper = faengeKoerper();
    await disponiereAdhoc(5, { bezeichnung: 'Decken' }, 2, { ergaenzen: false });
    await disponiereMaterial(5, 9, 2, { ort: { uhs_id: 1 } });
    expect(koerper).toEqual([
      { adhoc: { bezeichnung: 'Decken' }, menge: 2 },
      { material_id: 9, menge: 2, uhs_id: 1 },
    ]);
  });

  it('Stamm-Material nimmt den Bezug ebenso', async () => {
    const koerper = faengeKoerper();
    await disponiereMaterial(5, 9, 1, { nachforderungId: 4, ergaenzen: true });
    expect(koerper).toEqual([{ material_id: 9, menge: 1, nachforderung_id: 4, ergaenzen: true }]);
  });
});

describe('api/einsatzMaterial — vorhandenen Posten verknüpfen (LLH-1259 D1)', () => {
  it('sendet die Nachforderung an den eigenen Schreibweg, ergaenzen nur als true', async () => {
    const aufrufe: { pfad: string; koerper: unknown }[] = [];
    server.use(
      http.post('/api/einsaetze/:id/material/:em/nachforderung', async ({ request, params }) => {
        aufrufe.push({
          pfad: `${String(params.id)}/${String(params.em)}`,
          koerper: await request.json(),
        });
        return HttpResponse.json({ id: Number(params.em) });
      }),
    );
    await verknuepfeNachforderung(5, 7, 4, false);
    await verknuepfeNachforderung(5, 8, 4, true);
    expect(aufrufe).toEqual([
      { pfad: '5/7', koerper: { nachforderung_id: 4 } },
      { pfad: '5/8', koerper: { nachforderung_id: 4, ergaenzen: true } },
    ]);
  });
});
