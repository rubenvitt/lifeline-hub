import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import {
  ladeOrgEinstellungen,
  speichereOrgEinstellungen,
  ladeOrgModulEinstellungen,
  setzeOrgModulEinstellung,
} from './orgEinstellungen';
import type { OrgEinstellungen, OrgEinstellungenUpdate } from './types';

const beispielAnzeige: OrgEinstellungen = {
  zeitzone: 'Europe/Berlin',
  zeitformat: '24h',
  einheiten: 'metrisch',
  koordinatenformat: 'wgs84',
  retention_dauer_tage: 30,
  etb_nummer_praefix: 'ETB',
  meldung_nummer_praefix: 'M',
  auftrag_nummer_praefix: 'A',
  meldung_bestaetigung_frist_min: 10,
  auftrag_quittierung_frist_min: 15,
  auto_etb_eintraege: 1,
  geaendert_at: '2026-06-19 12:00:00',
  geaendert_von: 1,
};

describe('ladeOrgEinstellungen', () => {
  it('sendet GET an /api/org-einstellungen und liefert das Objekt', async () => {
    server.use(http.get('/api/org-einstellungen', () => HttpResponse.json(beispielAnzeige)));
    await expect(ladeOrgEinstellungen()).resolves.toEqual(beispielAnzeige);
  });

  it('liefert auch Objekte mit null-Feldern korrekt', async () => {
    const leer: OrgEinstellungen = {
      zeitzone: null,
      zeitformat: null,
      einheiten: null,
      koordinatenformat: null,
      retention_dauer_tage: null,
      etb_nummer_praefix: null,
      meldung_nummer_praefix: null,
      auftrag_nummer_praefix: null,
      meldung_bestaetigung_frist_min: null,
      auftrag_quittierung_frist_min: null,
      auto_etb_eintraege: null,
      geaendert_at: null,
      geaendert_von: null,
    };
    server.use(http.get('/api/org-einstellungen', () => HttpResponse.json(leer)));
    await expect(ladeOrgEinstellungen()).resolves.toEqual(leer);
  });
});

describe('speichereOrgEinstellungen', () => {
  it('sendet PUT an /api/org-einstellungen mit dem Update-Body', async () => {
    let empfangenerBody: unknown;
    const update: OrgEinstellungenUpdate = {
      zeitzone: 'UTC',
      zeitformat: null,
      einheiten: null,
      koordinatenformat: null,
      retention_dauer_tage: null,
      etb_nummer_praefix: null,
      meldung_nummer_praefix: null,
      auftrag_nummer_praefix: null,
      meldung_bestaetigung_frist_min: null,
      auftrag_quittierung_frist_min: null,
      auto_etb_eintraege: null,
    };
    server.use(
      http.put('/api/org-einstellungen', async ({ request }) => {
        empfangenerBody = await request.json();
        return HttpResponse.json({ ...update, geaendert_at: '2026-06-19 12:00:00', geaendert_von: 1, auto_etb_eintraege: null });
      }),
    );
    const result = await speichereOrgEinstellungen(update);
    expect(empfangenerBody).toEqual(update);
    expect(result.zeitzone).toBe('UTC');
  });

  it('übergibt auto_etb_eintraege als boolean im Body', async () => {
    let empfangenerBody: unknown;
    const update: OrgEinstellungenUpdate = {
      zeitzone: null,
      zeitformat: null,
      einheiten: null,
      koordinatenformat: null,
      retention_dauer_tage: null,
      etb_nummer_praefix: null,
      meldung_nummer_praefix: null,
      auftrag_nummer_praefix: null,
      meldung_bestaetigung_frist_min: null,
      auftrag_quittierung_frist_min: null,
      auto_etb_eintraege: false,
    };
    server.use(
      http.put('/api/org-einstellungen', async ({ request }) => {
        empfangenerBody = await request.json();
        return HttpResponse.json({ ...update, auto_etb_eintraege: 0, geaendert_at: null, geaendert_von: null });
      }),
    );
    await speichereOrgEinstellungen(update);
    expect((empfangenerBody as { auto_etb_eintraege: unknown }).auto_etb_eintraege).toBe(false);
  });
});

describe('ladeOrgModulEinstellungen', () => {
  it('sendet GET an /api/org-modul-einstellungen und liefert die Map', async () => {
    const map = { etb: 'admin' as const, lagekarte: 'fuehrungskraft' as const, sonstiges: null };
    server.use(http.get('/api/org-modul-einstellungen', () => HttpResponse.json(map)));
    await expect(ladeOrgModulEinstellungen()).resolves.toEqual(map);
  });

  it('liefert leere Map wenn keine Overrides gesetzt', async () => {
    server.use(http.get('/api/org-modul-einstellungen', () => HttpResponse.json({})));
    await expect(ladeOrgModulEinstellungen()).resolves.toEqual({});
  });
});

describe('setzeOrgModulEinstellung', () => {
  it('sendet PUT an /api/org-modul-einstellungen/:modulKey mit benoetigte_rolle', async () => {
    let empfangenerBody: unknown;
    let empfangenerKey: string | undefined;
    server.use(
      http.put('/api/org-modul-einstellungen/:modulKey', async ({ request, params }) => {
        empfangenerBody = await request.json();
        empfangenerKey = params.modulKey as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await setzeOrgModulEinstellung('etb', 'fuehrungskraft');
    expect(empfangenerKey).toBe('etb');
    expect(empfangenerBody).toEqual({ benoetigte_rolle: 'fuehrungskraft' });
  });

  it('erlaubt null als Rolle (kein Rollen-Zwang)', async () => {
    let empfangenerBody: unknown;
    server.use(
      http.put('/api/org-modul-einstellungen/:modulKey', async ({ request }) => {
        empfangenerBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await setzeOrgModulEinstellung('lagekarte', null);
    expect(empfangenerBody).toEqual({ benoetigte_rolle: null });
  });

  it('gibt void zurück (204 No Content)', async () => {
    server.use(
      http.put('/api/org-modul-einstellungen/:modulKey', () => new HttpResponse(null, { status: 204 })),
    );
    const result = await setzeOrgModulEinstellung('etb', 'admin');
    expect(result).toBeUndefined();
  });
});
