import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from './client';
import { hebtBrAbrufAuf, ruftAbAusBr } from './einsatzBereitstellungsraum';

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
