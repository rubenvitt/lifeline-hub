import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from './client';
import {
  aktualisiereBr,
  bucheEintreffen,
  hebtBrAbrufAuf,
  legeBrAn,
  ruftAbAusBr,
} from './einsatzBereitstellungsraum';

/** Abruf und Rücknahme gehen an eigene Routen (LLH-1085, Spec `bereitstellungsraum-belegung`). */
describe('Bereitstellungsraum — Abruf und Rücknahme', () => {
  afterEach(() => vi.restoreAllMocks());

  function aufrufe() {
    return vi.spyOn(client, 'apiSend').mockResolvedValue({} as never);
  }

  it('ruft mit Ziel, Auftrag und Ausrücken ab', async () => {
    const send = aufrufe();
    await ruftAbAusBr(4, 9, {
      objekt_typ: 'einheit',
      objekt_id: 12,
      abschnitt_id: 3,
      auftrag_text: 'Riegelstellung Nord',
      ausgerueckt: true,
    });
    expect(send).toHaveBeenCalledWith('/api/einsaetze/4/bereitstellungsraeume/9/abruf', 'POST', {
      objekt_typ: 'einheit',
      objekt_id: 12,
      abschnitt_id: 3,
      auftrag_text: 'Riegelstellung Nord',
      ausgerueckt: true,
    });
  });

  it('nimmt den Abruf eines Fahrzeugs zurück', async () => {
    const send = aufrufe();
    await hebtBrAbrufAuf(4, 9, { objekt_typ: 'fahrzeug', objekt_id: 5 });
    expect(send).toHaveBeenCalledWith(
      '/api/einsaetze/4/bereitstellungsraeume/9/abruf/aufheben',
      'POST',
      { objekt_typ: 'fahrzeug', objekt_id: 5 },
    );
  });
});

/** Koordinate des Raums (LLH-1107, Spec `bereitstellungsraum-lagekarte`). */
describe('Bereitstellungsraum — Koordinate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('PATCH nur Koordinate sendet genau lat und lon', async () => {
    const send = vi.spyOn(client, 'apiSend').mockResolvedValue({} as never);
    await aktualisiereBr(4, 9, { lat: 51.93, lon: 8.87 });
    expect(send).toHaveBeenCalledWith('/api/einsaetze/4/bereitstellungsraeume/9', 'PATCH', {
      lat: 51.93,
      lon: 8.87,
    });
    const body = send.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['lat', 'lon']);
  });

  it('Verortung entfernen sendet beide als null', async () => {
    const send = vi.spyOn(client, 'apiSend').mockResolvedValue({} as never);
    await aktualisiereBr(4, 9, { lat: null, lon: null });
    expect(send).toHaveBeenCalledWith('/api/einsaetze/4/bereitstellungsraeume/9', 'PATCH', {
      lat: null,
      lon: null,
    });
  });

  it('Anlegen nimmt Standort und Koordinate mit', async () => {
    const send = vi.spyOn(client, 'apiSend').mockResolvedValue({} as never);
    await legeBrAn(4, {
      bezeichnung: 'BR Sportplatz',
      standort: 'Sportplatz Nord',
      lat: 51.93,
      lon: 8.87,
    });
    expect(send).toHaveBeenCalledWith('/api/einsaetze/4/bereitstellungsraeume', 'POST', {
      bezeichnung: 'BR Sportplatz',
      standort: 'Sportplatz Nord',
      lat: 51.93,
      lon: 8.87,
    });
  });
});

/** Eintreffen buchen (LLH-1075, Spec `bereitstellungsraum-belegung`, design.md D1). */
describe('Bereitstellungsraum — Eintreffen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('bucht eine bekannte Kraft mit POST an …/eintreffen', async () => {
    const send = vi.spyOn(client, 'apiSend').mockResolvedValue({} as never);
    await bucheEintreffen(4, 9, { kraft: { objekt_typ: 'einheit', objekt_id: 12 } });
    expect(send).toHaveBeenCalledWith(
      '/api/einsaetze/4/bereitstellungsraeume/9/eintreffen',
      'POST',
      { kraft: { objekt_typ: 'einheit', objekt_id: 12 } },
      undefined,
    );
  });

  it('bucht eine unangemeldete Kraft mit dem Körper unverändert', async () => {
    const send = vi.spyOn(client, 'apiSend').mockResolvedValue({} as never);
    const unangemeldet = {
      fahrzeuge: [{ funkrufname: 'FL-MUS 1-44-1', fahrzeugtyp: 'HLF 20' }],
      staerke: { fuehrer: 1, unterfuehrer: 1, mannschaft: 7 },
      trotzdem_anlegen: true,
    };
    await bucheEintreffen(4, 9, { unangemeldet });
    expect(send).toHaveBeenCalledWith(
      '/api/einsaetze/4/bereitstellungsraeume/9/eintreffen',
      'POST',
      { unangemeldet },
      undefined,
    );
  });

  it('nennt beim Nachsenden den Besitzer der Warteschlange (LLH-1075 Teil III)', async () => {
    const send = vi.spyOn(client, 'apiSend').mockResolvedValue({} as never);
    const daten = { kraft: { objekt_typ: 'einheit' as const, objekt_id: 12 }, client_id: 'e1' };
    await bucheEintreffen(4, 9, daten, { offlineQueueBenutzerId: 11 });
    expect(send).toHaveBeenCalledWith(
      '/api/einsaetze/4/bereitstellungsraeume/9/eintreffen',
      'POST',
      daten,
      { offlineQueueBenutzerId: 11 },
    );
  });
});
