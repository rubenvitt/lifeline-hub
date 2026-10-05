import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aenderePlan,
  einpassen,
  raste,
  entfernePlan,
  hinterlegePlan,
  ladePlanBild,
  planBildPfad,
  uebernehmePlan,
} from './uhsPlan';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import type { UhsPlatz } from './types';

function platz(i: number, over: Partial<UhsPlatz> = {}): UhsPlatz {
  // Server-Raster: 5 Spalten, 160 × 120, Rand 10 (wie `raster` in `src/uhs/plan.rs`).
  return {
    id: i + 1,
    uhs_id: 2,
    typ: 'bett',
    bezeichnung: `Bett ${i + 1}`,
    pos_x: 10 + (i % 5) * 160,
    pos_y: 10 + Math.floor(i / 5) * 120,
    verfuegbarkeit: 'frei',
    reserviert_fuer_person_id: null,
    storniert_at: null,
    ...over,
  };
}
const raster = (n: number) => Array.from({ length: n }, (_, i) => platz(i));

describe('uhsPlan API (LFH-999)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lädt das Bild als Object-URL über die versionierte Adresse, ohne Protokoll-Route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['bild']), { status: 200 }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:plan');

    await expect(ladePlanBild(7, 2, 'ab12')).resolves.toBe('blob:plan');
    expect(planBildPfad(7, 2, 'ab12')).toBe('/api/einsaetze/7/uhs/2/plan/bild?v=ab12');
    // `?v=`: der Server erlaubt dem Browser, die Antwort ein Jahr zu behalten; ein neuer Plan
    // braucht deshalb eine neue Adresse, sonst käme der alte aus dem HTTP-Cache.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/einsaetze/7/uhs/2/plan/bild?v=ab12',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('gibt einem großen Plan das Upload-Zeitlimit und bricht mit der Query ab', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    let gesehen: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_pfad, init) => {
      gesehen = init?.signal ?? undefined;
      return new Promise((_ok, fehler) =>
        gesehen!.addEventListener('abort', () => fehler(gesehen!.reason)),
      );
    });
    const query = new AbortController();
    const laden = ladePlanBild(7, 2, 'ab12', query.signal);
    expect(timeout).toHaveBeenCalledWith(120_000);
    query.abort();
    await expect(laden).rejects.toBeDefined();
    expect(gesehen?.aborted).toBe(true);
  });

  it('wirft, wenn das Bild nicht kommt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    await expect(ladePlanBild(7, 2, 'ab12')).rejects.toThrow('404');
  });

  it('hinterlegt per PUT mit dem Feld `datei`', () => {
    const anfragen = installiereXhrAttrappe();
    const datei = new File([new Uint8Array([0x89])], 'halle.png', { type: 'image/png' });
    hinterlegePlan(7, 2, datei).catch(() => undefined);
    expect(anfragen[0].methode).toBe('PUT');
    expect(anfragen[0].url).toBe('/api/einsaetze/7/uhs/2/plan');
    expect((anfragen[0].body as FormData).get('datei')).toBe(datei);
  });

  it('übernimmt, ändert und entfernt über die eigenen Pfade', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
    await uebernehmePlan(7, 2, 31);
    await aenderePlan(7, 2, { helligkeit: 60 });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await entfernePlan(7, 2);
    const aufrufe = fetchMock.mock.calls.map(([pfad, init]) => [
      pfad,
      init?.method,
      init?.body ?? null,
    ]);
    expect(aufrufe).toEqual([
      ['/api/einsaetze/7/uhs/2/plan/aus-anhang', 'POST', '{"anhang_id":31}'],
      ['/api/einsaetze/7/uhs/2/plan', 'PATCH', '{"helligkeit":60}'],
      ['/api/einsaetze/7/uhs/2/plan', 'DELETE', null],
    ]);
  });
});

describe('einpassen — dieselbe Rechnung wie `startlage` im Server (LFH-999, D5a)', () => {
  it('liefert ohne Plätze 0/0/820', () => {
    expect(einpassen([], 800, 600)).toEqual({ x: 0, y: 0, breite: 820 });
  });

  it('trifft für zehn Rasterplätze die Werte des Servers', () => {
    // Dieselben Testdaten wie `startlage_ueberdeckt_zehn_rasterplaetze`.
    expect(einpassen(raster(10), 800, 600)).toEqual({ x: 0, y: 0, breite: 810 });
    expect(einpassen(raster(10), 400, 1600)).toEqual({ x: 0, y: 0, breite: 810 });
    expect(einpassen(raster(10), 1600, 400)).toEqual({ x: 0, y: 0, breite: 1070 });
  });

  it('setzt am Rahmen oben links an, auf das Raster abgerundet', () => {
    const verschoben = raster(10).map((p) => ({
      ...p,
      pos_x: p.pos_x! + 237,
      pos_y: p.pos_y! + 95,
    }));
    // min_x 247 − 20 = 227 → 220; min_y 105 − 20 = 85 → 80.
    expect(einpassen(verschoben, 800, 600)).toMatchObject({ x: 220, y: 80 });
  });

  it('deckelt die Breite wie der Server', () => {
    expect(einpassen(raster(50), 5000, 10).breite).toBe(5000);
  });

  it('lässt stornierte und unplatzierte Plätze aus, wie der Server', () => {
    const plaetze = [
      ...raster(1),
      platz(9, { storniert_at: 'x' }),
      platz(8, { pos_x: null, pos_y: null }),
    ];
    expect(einpassen(plaetze, 800, 600)).toEqual(einpassen(raster(1), 800, 600));
  });
});

describe('raste — dieselbe Regel wie im Server (LFH-999, D5)', () => {
  it('rastet auf 10 px, symmetrisch um null', () => {
    expect([raste(37), raste(-37), raste(35), raste(34), raste(0)]).toEqual([40, -40, 40, 30, 0]);
  });
});
