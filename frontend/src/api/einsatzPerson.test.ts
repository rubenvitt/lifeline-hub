import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMassnahme,
  createVerletzung,
  entfernePersonAnhang,
  ladePersonenDruck,
  revokeMassnahme,
  revokeVerletzung,
  saveTransport,
  loadPersonDruck,
  legePersonAnhangAb,
  listePersonAnhaenge,
  personAnhangDownloadPfad,
  savePersonFeld,
} from './einsatzPerson';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import type { UploadFortschritt } from './client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// LFH-727: Der Personendruck lädt über den protokollierenden Druck-Endpunkt, nie über die Liste.
describe('ladePersonenDruck', () => {
  it('ruft genau GET /api/einsaetze/{id}/personen/druck', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await expect(ladePersonenDruck(7)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/personen/druck');
    expect(init?.method ?? 'GET').toBe('GET');
  });
});

// LFH-757: Anhänge an einer Person laufen ausschließlich über die Personenroute.
describe('Personen-Anhänge-API', () => {
  it('listet über die Personenroute', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await listePersonAnhaenge(7, 3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/einsaetze/7/personen/3/anhaenge');
  });

  it('legt EINE Datei im Feld `datei` ab, mit dem 120-s-Upload-Timeout', async () => {
    const anfragen = installiereXhrAttrappe();
    const datei = new File(['x'], 'verletzung.jpg', { type: 'image/jpeg' });
    const ergebnis = legePersonAnhangAb(7, 3, datei);
    const [xhr] = anfragen;
    expect(xhr.url).toBe('/api/einsaetze/7/personen/3/anhaenge');
    expect(xhr.methode).toBe('POST');
    const fd = xhr.body as FormData;
    expect(fd.get('datei')).toBe(datei);
    expect([...fd.keys()]).toEqual(['datei']);
    expect(xhr.timeout).toBe(120_000);
    xhr.antworten(201, { id: 1 });
    await expect(ergebnis).resolves.toEqual({ id: 1 });
  });

  it('reicht den Fortschritt an den Aufrufer durch (LFH-878)', () => {
    const anfragen = installiereXhrAttrappe();
    const meldungen: UploadFortschritt[] = [];
    void legePersonAnhangAb(7, 3, new File(['x'], 'v.jpg'), (f) => meldungen.push(f));
    anfragen[0].fortschritt(1, 4);
    anfragen[0].uebertragen();
    expect(meldungen).toEqual([{ phase: 'senden', anteil: 0.25 }, { phase: 'pruefen' }]);
  });

  it('entfernt per DELETE auf die Linker-id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await entfernePersonAnhang(7, 3, 42);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/personen/3/anhaenge/42');
    expect(init?.method).toBe('DELETE');
  });

  it('baut den Download-Pfad an der Personenroute, nie an /anhaenge des Einsatzes', () => {
    const p = personAnhangDownloadPfad(7, 3, 42);
    expect(p).toBe('/api/einsaetze/7/personen/3/anhaenge/42/datei');
    expect(p.startsWith('/api/einsaetze/7/anhaenge')).toBe(false);
  });
});

// LLH-1324/1325/1113 (Change `y18v58dt-pat-kern`): je Schreibweg EINE Funktion, damit die
// Offline-Vormerkung (Abschnitt 8) genau dort ansetzt.
describe('PAT-Kern-Schreibwege', () => {
  function antwort(body: unknown = { id: 1 }) {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));
  }
  function aufruf(fetchMock: ReturnType<typeof antwort>) {
    const [pfad, init] = fetchMock.mock.calls[0];
    return {
      pfad,
      methode: init?.method,
      body: init?.body == null ? undefined : JSON.parse(String(init.body)),
    };
  }

  it('legt den Transport als vollen Stand fest, leere Felder als null', async () => {
    const f = antwort();
    await saveTransport(7, 3, { prioritaet: 'dringlich', art: null, fachrichtung: null });
    expect(aufruf(f)).toEqual({
      pfad: '/api/einsaetze/7/personen/3/transport',
      methode: 'POST',
      body: { prioritaet: 'dringlich', art: null, fachrichtung: null },
    });
  });

  it('nennt am Gerät die bestätigende Person beim Transport', async () => {
    const f = antwort();
    await saveTransport(7, 3, {
      prioritaet: null,
      art: 'liegend',
      fachrichtung: 'neuro',
      bestaetigt_personal_id: 12,
    });
    expect(aufruf(f).body).toEqual({
      prioritaet: null,
      art: 'liegend',
      fachrichtung: 'neuro',
      bestaetigt_personal_id: 12,
    });
  });

  it('erfasst eine Maßnahme mit Durchführung und hebt sie per POST auf', async () => {
    const f = antwort();
    await createMassnahme(7, 3, { art: 'blutstillung', zeitpunkt_at: '2026-10-18T12:05:00Z' });
    expect(aufruf(f)).toEqual({
      pfad: '/api/einsaetze/7/personen/3/massnahmen',
      methode: 'POST',
      body: { art: 'blutstillung', zeitpunkt_at: '2026-10-18T12:05:00Z' },
    });
    f.mockClear();
    f.mockResolvedValue(new Response(JSON.stringify({ id: 4 }), { status: 200 }));
    await revokeMassnahme(7, 3, 4);
    expect(aufruf(f)).toEqual({
      pfad: '/api/einsaetze/7/personen/3/massnahmen/4/aufheben',
      methode: 'POST',
      body: undefined,
    });
  });

  it('markiert eine Verletzung mit Lage und hebt sie per POST auf', async () => {
    const f = antwort();
    await createVerletzung(7, 3, {
      ansicht: 'vorn',
      region: 'unterarm_l',
      art: 'fraktur_verdacht',
      x: 0.8,
      y: 0.45,
    });
    expect(aufruf(f)).toEqual({
      pfad: '/api/einsaetze/7/personen/3/verletzungen',
      methode: 'POST',
      body: { ansicht: 'vorn', region: 'unterarm_l', art: 'fraktur_verdacht', x: 0.8, y: 0.45 },
    });
    f.mockClear();
    f.mockResolvedValue(new Response(JSON.stringify({ id: 9 }), { status: 200 }));
    await revokeVerletzung(7, 3, 9);
    expect(aufruf(f).pfad).toBe('/api/einsaetze/7/personen/3/verletzungen/9/aufheben');
    expect(aufruf(f).methode).toBe('POST');
  });
});
// Die Druckansicht einer Person (LLH-1120) lädt über den protokollierenden Druck-Endpunkt der
// Person, nie über das Detail: das Öffnen steht als `druck` im Zugriffsprotokoll.
describe('loadPersonDruck', () => {
  it('ruft genau GET /api/einsaetze/{id}/personen/{pid}/druck', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"id":3}', { status: 200 }));
    await expect(loadPersonDruck(7, 3)).resolves.toEqual({ id: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/personen/3/druck');
    expect(init?.method ?? 'GET').toBe('GET');
  });
});

/**
 * Ein Feld je PATCH mit Feld-CAS (LLH-1103, design.md D1): genau das Feld und sein Wert beim Öffnen
 * unter `erwartet`; die Koordinate als Paar; ohne Altwert (Überschreiben) kein `erwartet`.
 *
 * Mutationsprobe: `erwartet` immer mitsenden — rot in „ohne Altwert“.
 */
describe('savePersonFeld', () => {
  function body(fetchMock: { mock: { calls: unknown[][] } }) {
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    return { methode: init.method, daten: JSON.parse(String(init.body)) };
  }
  function attrappe() {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  }

  it('schickt genau ein Feld mit seinem Altwert', async () => {
    const fetchMock = attrappe();
    await savePersonFeld(7, 3, 'name', 'Müller', 'Meier');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/einsaetze/7/personen/3');
    expect(body(fetchMock)).toEqual({
      methode: 'PATCH',
      daten: { name: 'Müller', erwartet: { name: 'Meier' } },
    });
  });

  it('leer erwartet ist null, Leeren ist null', async () => {
    const fetchMock = attrappe();
    await savePersonFeld(7, 3, 'melder_kontakt', null, null);
    expect(body(fetchMock).daten).toEqual({
      melder_kontakt: null,
      erwartet: { melder_kontakt: null },
    });
  });

  it('die Koordinate geht als Paar, auch im Altwert', async () => {
    const fetchMock = attrappe();
    await savePersonFeld(7, 3, 'koordinate', { lat: 52.1, lon: 9.2 }, null);
    expect(body(fetchMock).daten).toEqual({
      antreff_lat: 52.1,
      antreff_lon: 9.2,
      erwartet: { antreff_lat: null, antreff_lon: null },
    });
  });

  it('ohne Altwert (Überschreiben) kein `erwartet`', async () => {
    const fetchMock = attrappe();
    await savePersonFeld(7, 3, 'koordinate', null, undefined);
    expect(body(fetchMock).daten).toEqual({ antreff_lat: null, antreff_lon: null });
  });
});
