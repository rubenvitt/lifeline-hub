import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHADEN_SORTIERUNG_VORGABE } from '../api/einsatzSchaden';
import { einsatzKeys } from '../api/queryKeys';
import type { Medienkontakt, Schaden } from '../api/types';
import { erzeugeLiveSammler, LIVE_SAMMELFENSTER_MS } from './liveInvalidierung';
import { erzeugeZeilenSammler, fensterEinsortieren } from './zeilenAbgleich';

const api = vi.hoisted(() => ({ ladeSchaden: vi.fn(), ladeMedienkontakt: vi.fn() }));

vi.mock('../api/einsatzSchaden', async (orig) => ({
  ...(await orig<typeof import('../api/einsatzSchaden')>()),
  ladeSchaden: api.ladeSchaden,
}));
vi.mock('../api/presse', async (orig) => ({
  ...(await orig<typeof import('../api/presse')>()),
  ladeMedienkontakt: api.ladeMedienkontakt,
}));

const E = 7;

const schaden = (id: number, registrier_nr: number, extra: Partial<Schaden> = {}) =>
  ({
    id,
    registrier_nr,
    status: 'offen',
    typ: 'sachschaden',
    ausmass: 'gering',
    ort: `Ort ${id}`,
    lat: 53.1,
    lon: 8.2,
    storniert_at: null,
    ...extra,
  }) as unknown as Schaden;

const kontakt = (id: number, status: string, eingang_at: string) =>
  ({ id, status, eingang_at, thema: `Thema ${id}` }) as unknown as Medienkontakt;

const ketten = <T>(...pages: T[][]): InfiniteData<T[]> => ({
  pages,
  pageParams: pages.map((_, i) => i),
});

const ids = (d: InfiniteData<{ id: number }[]> | undefined) =>
  d?.pages.map((p) => p.map((z) => z.id));

describe('fensterEinsortieren (LFH-1075)', () => {
  // Absteigend nach Kennung, Seitengröße 2.
  const vergleich = (a: { id: number }, b: { id: number }) => b.id - a.id;

  it('ersetzt eine geladene Zeile an ihrem Platz', () => {
    const alt = ketten(
      [
        { id: 9, w: 0 },
        { id: 8, w: 0 },
      ],
      [
        { id: 6, w: 0 },
        { id: 5, w: 0 },
      ],
    );
    const neu = fensterEinsortieren(alt, 6, { id: 6, w: 1 }, vergleich, 2);
    expect(ids(neu)).toEqual([
      [9, 8],
      [6, 5],
    ]);
    expect(neu.pages[1][0]).toEqual({ id: 6, w: 1 });
    expect(neu.pageParams).toBe(alt.pageParams);
  });

  it('reiht eine neue Zeile vorn ein, wenn sie vor die erste gehört', () => {
    const neu = fensterEinsortieren(
      ketten([{ id: 9 }, { id: 8 }], [{ id: 6 }]),
      12,
      { id: 12 },
      vergleich,
      2,
    );
    expect(ids(neu)).toEqual([[12, 9, 8], [6]]);
  });

  it('reiht eine neue Zeile in die Seite ein, in die sie nach der Ordnung gehört', () => {
    const neu = fensterEinsortieren(
      ketten([{ id: 9 }, { id: 8 }], [{ id: 6 }, { id: 5 }]),
      7,
      { id: 7 },
      vergleich,
      2,
    );
    expect(ids(neu)).toEqual([
      [9, 8],
      [7, 6, 5],
    ]);
  });

  it('sortiert eine Zeile außerhalb des Fensters nicht ein, solange der Server weitere Seiten hat', () => {
    const alt = ketten([{ id: 9 }, { id: 8 }], [{ id: 6 }, { id: 5 }]);
    expect(fensterEinsortieren(alt, 3, { id: 3 }, vergleich, 2)).toBe(alt);
  });

  it('hängt eine Zeile hinten an, wenn die letzte Seite das Ende des Bestands ist', () => {
    const neu = fensterEinsortieren(
      ketten([{ id: 9 }, { id: 8 }], [{ id: 6 }]),
      3,
      { id: 3 },
      vergleich,
      2,
    );
    expect(ids(neu)).toEqual([
      [9, 8],
      [6, 3],
    ]);
  });

  it('nimmt eine Zeile heraus, die aus dem Fenster wandert oder nicht mehr hineingehört', () => {
    const alt = ketten([{ id: 9 }, { id: 8 }], [{ id: 6 }, { id: 5 }]);
    expect(ids(fensterEinsortieren(alt, 8, null, vergleich, 2))).toEqual([[9], [6, 5]]);
    // Die Zeile 8 sortiert nach der Änderung hinter die letzte geladene: sie fällt heraus.
    const wandert = (a: { id: number; k?: number }, b: { id: number; k?: number }) =>
      (b.k ?? b.id) - (a.k ?? a.id);
    expect(ids(fensterEinsortieren(alt, 8, { id: 8, k: 1 } as { id: number }, wandert, 2))).toEqual(
      [[9], [6, 5]],
    );
  });

  it('lässt eine unbeteiligte Kette unverändert', () => {
    const alt = ketten([{ id: 9 }, { id: 8 }], [{ id: 6 }, { id: 5 }]);
    expect(fensterEinsortieren(alt, 4, null, vergleich, 2)).toBe(alt);
  });
});

/** Das Sammelfenster ablaufen lassen und die Zeilenabrufe auflösen. */
async function fenster() {
  await vi.advanceTimersByTimeAsync(LIVE_SAMMELFENSTER_MS);
}

function aufbau() {
  const qc = new QueryClient();
  const inval = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
  const zeilen = erzeugeZeilenSammler(qc, erzeugeLiveSammler(qc), E);
  return { qc, inval, zeilen };
}

const invalidierteKeys = (inval: ReturnType<typeof aufbau>['inval']) =>
  inval.mock.calls.map((c) => c[0]?.queryKey);

beforeEach(() => {
  vi.useFakeTimers();
  api.ladeSchaden.mockReset();
  api.ladeMedienkontakt.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Zeilenabgleich in Seitenketten (LFH-1075)', () => {
  const vorgabe = einsatzKeys.schaedenSeiten(E, {}, SCHADEN_SORTIERUNG_VORGABE);

  it('reiht einen neuen Schaden in der Vorgabesicht oben ein, ohne die Kette neu zu laden', async () => {
    const { qc, inval, zeilen } = aufbau();
    qc.setQueryData(vorgabe, ketten([schaden(2, 2), schaden(1, 1)]));
    api.ladeSchaden.mockResolvedValue(schaden(3, 3));

    zeilen.vormerken('schaeden', 3);
    await fenster();

    expect(ids(qc.getQueryData(vorgabe))).toEqual([[3, 2, 1]]);
    expect(inval).not.toHaveBeenCalled();
  });

  it('lässt eine Kette mit gefüllter letzter Seite unverändert, wenn der Schaden dahinter sortiert', async () => {
    const { qc, zeilen } = aufbau();
    const nachAusmass = einsatzKeys.schaedenSeiten(E, {}, { spalte: 'ausmass', richtung: 'ab' });
    // Volle Seite (100) mit großem Ausmaß; der geänderte Schaden ist gering und läge dahinter.
    const seite = Array.from({ length: 100 }, (_, i) =>
      schaden(1000 - i, 1000 - i, { ausmass: 'gross' }),
    );
    const alt = ketten(seite);
    qc.setQueryData(nachAusmass, alt);
    api.ladeSchaden.mockResolvedValue(schaden(5, 5, { ausmass: 'gering' }));

    zeilen.vormerken('schaeden', 5);
    await fenster();

    expect(qc.getQueryData(nachAusmass)).toBe(alt);
  });

  it('entfernt einen stornierten oder aus dem Filter gefallenen Schaden aus der Kette', async () => {
    const { qc, zeilen } = aufbau();
    const offen = einsatzKeys.schaedenSeiten(E, { status: 'offen' }, SCHADEN_SORTIERUNG_VORGABE);
    qc.setQueryData(vorgabe, ketten([schaden(2, 2), schaden(1, 1)]));
    qc.setQueryData(offen, ketten([schaden(2, 2), schaden(1, 1)]));
    api.ladeSchaden.mockImplementation(async (_e: number, id: number) =>
      id === 2
        ? schaden(2, 2, { storniert_at: '2026-10-08T07:00:00' } as Partial<Schaden>)
        : schaden(1, 1, { status: 'uebergeben' }),
    );

    zeilen.vormerken('schaeden', 2);
    zeilen.vormerken('schaeden', 1);
    await fenster();

    expect(ids(qc.getQueryData(vorgabe))).toEqual([[1]]);
    expect(ids(qc.getQueryData(offen))).toEqual([[]]);
  });

  it('gibt eine Kette mit Suchbegriff an den Sammler, die übrigen gleicht er ab', async () => {
    const { qc, inval, zeilen } = aufbau();
    const gesucht = einsatzKeys.schaedenSeiten(E, { q: 'Deich' }, SCHADEN_SORTIERUNG_VORGABE);
    const alt = ketten([schaden(2, 2)]);
    qc.setQueryData(gesucht, alt);
    qc.setQueryData(vorgabe, ketten([schaden(2, 2)]));
    api.ladeSchaden.mockResolvedValue(schaden(3, 3));

    zeilen.vormerken('schaeden', 3);
    await fenster(); // Zeilenabruf
    await fenster(); // Sammelfenster des Live-Sammlers

    expect(qc.getQueryData(gesucht)).toBe(alt);
    expect(invalidierteKeys(inval)).toContainEqual(gesucht);
    expect(ids(qc.getQueryData(vorgabe))).toEqual([[3, 2]]);
  });

  it('schreibt den Einzelabruf und die Auswahl mit, Fremde Einzelabrufe bleiben', async () => {
    const { qc, zeilen } = aufbau();
    const fremd = schaden(4, 4);
    qc.setQueryData(einsatzKeys.schaedenEinzeln(E, 3), schaden(3, 3, { ort: 'alt' }));
    qc.setQueryData(einsatzKeys.schaedenEinzeln(E, 4), fremd);
    qc.setQueryData(einsatzKeys.schaedenAuswahl(E), []);
    api.ladeSchaden.mockResolvedValue(schaden(3, 3, { ort: 'neu' }));

    zeilen.vormerken('schaeden', 3);
    await fenster();

    expect(qc.getQueryData<Schaden>(einsatzKeys.schaedenEinzeln(E, 3))?.ort).toBe('neu');
    expect(qc.getQueryData(einsatzKeys.schaedenEinzeln(E, 4))).toBe(fremd);
    expect(qc.getQueryData(einsatzKeys.schaedenAuswahl(E))).toEqual([
      expect.objectContaining({ id: 3, registrier_nr: 3, ort: 'neu', frei: true }),
    ]);
  });

  it('ein Medienkontakt wechselt bei Rücknahme von den erledigten zu den offenen', async () => {
    const { qc, inval, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.medienkontakteOffen(E), [
      kontakt(5, 'offen', '2026-10-08T06:00:00'),
    ]);
    qc.setQueryData(
      einsatzKeys.medienkontakteErledigt(E),
      ketten([
        kontakt(4, 'erledigt', '2026-10-08T05:00:00'),
        kontakt(3, 'erledigt', '2026-10-08T04:00:00'),
      ]),
    );
    api.ladeMedienkontakt.mockResolvedValue(kontakt(4, 'offen', '2026-10-08T05:00:00'));

    zeilen.vormerken('medienkontakte', 4);
    await fenster();

    expect(
      qc.getQueryData<Medienkontakt[]>(einsatzKeys.medienkontakteOffen(E))?.map((k) => k.id),
    ).toEqual([5, 4]);
    expect(ids(qc.getQueryData(einsatzKeys.medienkontakteErledigt(E)))).toEqual([[3]]);
    expect(inval).not.toHaveBeenCalled();
  });
});
