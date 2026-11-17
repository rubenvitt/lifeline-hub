import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAbschlussPruefung, oeffneEinsatzWieder, patcheEinsatz } from './einsaetze';

/**
 * Der Teil-PATCH der Kopfdaten (LFH-472). Eine Zeile der Einsatzdaten schickt NUR ihr Feld —
 * ein mitgeschicktes fremdes Feld überschriebe die gleichzeitige Änderung einer anderen Person.
 */
describe('api/einsaetze · patcheEinsatz', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{"id":7}', { status: 200 }));
  });

  function aufruf(): { pfad: string; init: RequestInit } {
    const [pfad, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { pfad, init };
  }

  it('schickt genau die übergebenen Schlüssel per PATCH', async () => {
    await patcheEinsatz(7, { leitstellen_nr: 'ILS-4711' });
    const { pfad, init } = aufruf();
    expect(pfad).toBe('/api/einsaetze/7');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ leitstellen_nr: 'ILS-4711' });
  });

  it('erhält ein explizites null (leeren), statt es wegzulassen', async () => {
    await patcheEinsatz(7, { einsatzort: null });
    expect(JSON.parse(aufruf().init.body as string)).toEqual({ einsatzort: null });
  });
});

/**
 * Einsatzabschluss absichern (LLH-1814, Spec `einsatz-abschluss`): die offenen Punkte vor dem
 * Abschluss und das Wiederöffnen mit Pflicht-Grund.
 */
describe('api/einsaetze · Abschlussprüfung und Wiederöffnen (LLH-1814)', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{"id":7}', { status: 200 }));
  });

  function aufruf(): { pfad: string; init: RequestInit | undefined } {
    const [pfad, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    return { pfad, init };
  }

  it('fragt die offenen Punkte per GET am Abschluss des Einsatzes ab', async () => {
    await loadAbschlussPruefung(7);
    const { pfad, init } = aufruf();
    expect(pfad).toBe('/api/einsaetze/7/abschluss/pruefung');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('öffnet per POST mit dem Grund im Body wieder', async () => {
    await oeffneEinsatzWieder(7, 'Falscher Einsatz abgeschlossen');
    const { pfad, init } = aufruf();
    expect(pfad).toBe('/api/einsaetze/7/wiedereroeffnen');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ grund: 'Falscher Einsatz abgeschlossen' });
  });
});
