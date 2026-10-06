import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { einsatzKeys } from '../api/queryKeys';
import type { Medienkontakt, Schaden, SchadenMarker } from '../api/types';
import { erzeugeLiveSammler, LIVE_SAMMELFENSTER_MS } from './liveInvalidierung';
import { einsortieren, erzeugeZeilenSammler, ZEILEN_GRENZE } from './zeilenAbgleich';

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

function sichtbarkeit(wert: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => wert });
}

const kontakt = (id: number, status: string, eingang_at: string) =>
  ({ id, status, eingang_at, thema: `Thema ${id}` }) as unknown as Medienkontakt;

const schaden = (id: number, registrier_nr: number, extra: Partial<Schaden> = {}) =>
  ({
    id,
    registrier_nr,
    status: 'offen',
    typ: 'sachschaden',
    ausmass: 'gering',
    lat: 53.1,
    lon: 8.2,
    beschreibung: 'Freitext',
    storniert_at: null,
    ...extra,
  }) as unknown as Schaden;

/** Fenster ablaufen lassen und die Zeilenabrufe auflösen. */
async function fenster() {
  await vi.advanceTimersByTimeAsync(LIVE_SAMMELFENSTER_MS);
}

function aufbau() {
  const qc = new QueryClient();
  const inval = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
  const sammler = erzeugeLiveSammler(qc);
  const zeilen = erzeugeZeilenSammler(qc, sammler, E);
  return { qc, inval, sammler, zeilen };
}

const invalidierteKeys = (inval: ReturnType<typeof aufbau>['inval']) =>
  inval.mock.calls.map((c) => c[0]?.queryKey);

beforeEach(() => {
  vi.useFakeTimers();
  sichtbarkeit('visible');
  api.ladeSchaden.mockReset();
  api.ladeMedienkontakt.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  sichtbarkeit('visible');
});

describe('einsortieren (LFH-931)', () => {
  const vergleich = (a: { id: number }, b: { id: number }) => b.id - a.id;

  it('ersetzt, ergänzt und entfernt eine Zeile und sortiert wie der Server', () => {
    const liste = [{ id: 3 }, { id: 1 }];
    expect(einsortieren(liste, 2, { id: 2 }, vergleich)).toEqual([{ id: 3 }, { id: 2 }, { id: 1 }]);
    expect(einsortieren(liste, 3, null, vergleich)).toEqual([{ id: 1 }]);
    expect(einsortieren(liste, 1, { id: 1 }, vergleich)).toEqual(liste);
  });
});

describe('erzeugeZeilenSammler (LFH-931)', () => {
  it('lädt nur die geänderte Zeile und sortiert sie ein, ohne die Liste abzurufen', async () => {
    const { qc, inval, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.medienkontakte(E), [
      kontakt(2, 'offen', '2026-10-06T10:00:00Z'),
      kontakt(1, 'offen', '2026-10-06T09:00:00Z'),
    ]);
    api.ladeMedienkontakt.mockResolvedValue(kontakt(2, 'beantwortet', '2026-10-06T10:00:00Z'));

    zeilen.vormerken('medienkontakte', 2);
    zeilen.vormerken('medienkontakte', 2);
    await fenster();

    expect(api.ladeMedienkontakt).toHaveBeenCalledTimes(1);
    expect(api.ladeMedienkontakt).toHaveBeenCalledWith(E, 2);
    // Beantwortet rückt hinter die offenen.
    expect(
      qc.getQueryData<Medienkontakt[]>(einsatzKeys.medienkontakte(E))?.map((k) => [k.id, k.status]),
    ).toEqual([
      [1, 'offen'],
      [2, 'beantwortet'],
    ]);
    await vi.advanceTimersByTimeAsync(LIVE_SAMMELFENSTER_MS);
    expect(inval).not.toHaveBeenCalled();
  });

  it('eine Rücknahme sortiert die Zeile zu den offenen zurück', async () => {
    const { qc, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.medienkontakte(E), [
      kontakt(1, 'offen', '2026-10-06T09:00:00Z'),
      kontakt(2, 'beantwortet', '2026-10-06T10:00:00Z'),
    ]);
    api.ladeMedienkontakt.mockResolvedValue(kontakt(2, 'offen', '2026-10-06T10:00:00Z'));

    zeilen.vormerken('medienkontakte', 2);
    await fenster();

    expect(
      qc.getQueryData<Medienkontakt[]>(einsatzKeys.medienkontakte(E))?.map((k) => k.id),
    ).toEqual([2, 1]);
  });

  it('ordnet bei gleichem Eingang nach der Kennung absteigend wie das SQL', async () => {
    const { qc, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.medienkontakte(E), [
      kontakt(5, 'offen', '2026-10-06T09:00:00Z'),
      kontakt(3, 'offen', '2026-10-06T09:00:00Z'),
    ]);
    api.ladeMedienkontakt.mockResolvedValue(kontakt(4, 'offen', '2026-10-06T09:00:00Z'));

    zeilen.vormerken('medienkontakte', 4);
    await fenster();

    expect(
      qc.getQueryData<Medienkontakt[]>(einsatzKeys.medienkontakte(E))?.map((k) => k.id),
    ).toEqual([5, 4, 3]);
  });

  it('aktualisiert Schadenliste und Marker aus einem Abruf; der Marker trägt keine Freitexte', async () => {
    const { qc, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.schaeden(E), [schaden(1, 1)]);
    qc.setQueryData(einsatzKeys.schadenMarker(E), [
      { id: 1, registrier_nr: 1, status: 'offen', typ: 'sachschaden', ausmass: 'gering' },
    ]);
    api.ladeSchaden.mockResolvedValue(schaden(2, 2, { ausmass: 'gross' }));

    zeilen.vormerken('schaeden', 2);
    await fenster();

    expect(api.ladeSchaden).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData<Schaden[]>(einsatzKeys.schaeden(E))?.map((s) => s.id)).toEqual([2, 1]);
    const marker = qc.getQueryData<SchadenMarker[]>(einsatzKeys.schadenMarker(E));
    expect(marker?.[0]).toEqual({
      id: 2,
      registrier_nr: 2,
      status: 'offen',
      typ: 'sachschaden',
      ausmass: 'gross',
      lat: 53.1,
      lon: 8.2,
    });
  });

  it('ein Storno entfernt die Zeile aus Liste und Marker', async () => {
    const { qc, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.schaeden(E), [schaden(2, 2), schaden(1, 1)]);
    qc.setQueryData(einsatzKeys.schadenMarker(E), [{ id: 2 }, { id: 1 }]);
    api.ladeSchaden.mockResolvedValue(schaden(2, 2, { storniert_at: '2026-10-06T11:00:00Z' }));

    zeilen.vormerken('schaeden', 2);
    await fenster();

    expect(qc.getQueryData<Schaden[]>(einsatzKeys.schaeden(E))?.map((s) => s.id)).toEqual([1]);
    expect(qc.getQueryData<{ id: number }[]>(einsatzKeys.schadenMarker(E))).toEqual([{ id: 1 }]);
  });

  it('lässt eine nicht geladene Liste ungeladen', async () => {
    const { qc, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.schadenMarker(E), []);
    api.ladeSchaden.mockResolvedValue(schaden(2, 2));

    zeilen.vormerken('schaeden', 2);
    await fenster();

    expect(qc.getQueryData(einsatzKeys.schaeden(E))).toBeUndefined();
    expect(
      qc.getQueryData<{ id: number }[]>(einsatzKeys.schadenMarker(E))?.map((s) => s.id),
    ).toEqual([2]);
  });

  it('ohne geladene Liste geht das Ereignis als Prefix an den Sammler', async () => {
    const { inval, zeilen } = aufbau();

    zeilen.vormerken('medienkontakte', 2);
    await fenster();
    await vi.advanceTimersByTimeAsync(LIVE_SAMMELFENSTER_MS);

    expect(api.ladeMedienkontakt).not.toHaveBeenCalled();
    expect(invalidierteKeys(inval)).toEqual([einsatzKeys.medienkontakte(E)]);
  });

  it('im verdeckten Tab lädt sie keine Zeile, sondern merkt die Listen vor', async () => {
    const { qc, inval, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.medienkontakte(E), []);
    sichtbarkeit('hidden');

    zeilen.vormerken('medienkontakte', 2);
    await fenster();

    expect(api.ladeMedienkontakt).not.toHaveBeenCalled();
    // Der Sammler merkt im verdeckten Tab nur (`refetchType: 'none'`); abgerufen wird beim Zurückkehren.
    await vi.advanceTimersByTimeAsync(LIVE_SAMMELFENSTER_MS);
    expect(invalidierteKeys(inval)).toEqual([einsatzKeys.medienkontakte(E)]);
  });

  it(`über ${ZEILEN_GRENZE} Kennungen im Fenster ruft sie die Liste einmal ab`, async () => {
    const { qc, inval, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.medienkontakte(E), []);

    for (let id = 1; id <= ZEILEN_GRENZE + 1; id += 1) zeilen.vormerken('medienkontakte', id);
    await fenster();
    await vi.advanceTimersByTimeAsync(LIVE_SAMMELFENSTER_MS);

    expect(api.ladeMedienkontakt).not.toHaveBeenCalled();
    expect(invalidierteKeys(inval)).toEqual([einsatzKeys.medienkontakte(E)]);
  });

  it('bis zur Grenze lädt sie jede Zeile einzeln', async () => {
    const { qc, inval, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.medienkontakte(E), []);
    api.ladeMedienkontakt.mockImplementation((_e: number, id: number) =>
      Promise.resolve(kontakt(id, 'offen', '2026-10-06T09:00:00Z')),
    );

    for (let id = 1; id <= ZEILEN_GRENZE; id += 1) zeilen.vormerken('medienkontakte', id);
    await fenster();

    expect(api.ladeMedienkontakt).toHaveBeenCalledTimes(ZEILEN_GRENZE);
    expect(qc.getQueryData<Medienkontakt[]>(einsatzKeys.medienkontakte(E))).toHaveLength(
      ZEILEN_GRENZE,
    );
    expect(inval).not.toHaveBeenCalled();
  });

  it('scheitert ein Zeilenabruf, gleicht sie die Liste als Ganzes ab', async () => {
    const { qc, inval, zeilen } = aufbau();
    const vorher = [kontakt(1, 'offen', '2026-10-06T09:00:00Z')];
    qc.setQueryData(einsatzKeys.medienkontakte(E), vorher);
    api.ladeMedienkontakt.mockRejectedValue(new Error('404'));

    zeilen.vormerken('medienkontakte', 2);
    await fenster();
    await vi.advanceTimersByTimeAsync(LIVE_SAMMELFENSTER_MS);

    expect(qc.getQueryData(einsatzKeys.medienkontakte(E))).toBe(vorher);
    expect(invalidierteKeys(inval)).toEqual([einsatzKeys.medienkontakte(E)]);
  });

  it('läuft ein Listenabruf, wartet die Kennung auf das nächste Fenster', async () => {
    const { qc, zeilen } = aufbau();
    let freigeben: (l: Medienkontakt[]) => void = () => {};
    qc.setQueryData(einsatzKeys.medienkontakte(E), []);
    void qc.fetchQuery({
      queryKey: einsatzKeys.medienkontakte(E),
      queryFn: () => new Promise<Medienkontakt[]>((r) => (freigeben = r)),
    });
    api.ladeMedienkontakt.mockResolvedValue(kontakt(2, 'offen', '2026-10-06T10:00:00Z'));

    zeilen.vormerken('medienkontakte', 2);
    await fenster();
    expect(api.ladeMedienkontakt).not.toHaveBeenCalled();

    // Die Liste kommt ohne die Zeile zurück (vor der Änderung gelesen); das nächste Fenster holt sie.
    freigeben([kontakt(1, 'offen', '2026-10-06T09:00:00Z')]);
    await vi.advanceTimersByTimeAsync(0);
    await fenster();

    expect(api.ladeMedienkontakt).toHaveBeenCalledTimes(1);
    expect(
      qc.getQueryData<Medienkontakt[]>(einsatzKeys.medienkontakte(E))?.map((k) => k.id),
    ).toEqual([2, 1]);
  });

  it('beginnt während des Zeilenabrufs ein Listenabruf, überlässt sie der Liste das Ergebnis', async () => {
    const { qc, sammler, zeilen } = aufbau();
    const vormerken = vi.spyOn(sammler, 'vormerken');
    qc.setQueryData(einsatzKeys.medienkontakte(E), []);
    let zeileFreigeben: (k: Medienkontakt) => void = () => {};
    api.ladeMedienkontakt.mockReturnValue(new Promise<Medienkontakt>((r) => (zeileFreigeben = r)));

    zeilen.vormerken('medienkontakte', 2);
    await fenster();
    expect(api.ladeMedienkontakt).toHaveBeenCalledTimes(1);

    void qc.fetchQuery({
      queryKey: einsatzKeys.medienkontakte(E),
      queryFn: () => new Promise<Medienkontakt[]>(() => {}),
    });
    zeileFreigeben(kontakt(2, 'offen', '2026-10-06T10:00:00Z'));
    await vi.advanceTimersByTimeAsync(0);

    // Die Zeile landet nicht im Cache; der Sammler gleicht die Liste nach ihrem Abruf ab.
    expect(qc.getQueryData(einsatzKeys.medienkontakte(E))).toEqual([]);
    expect(vormerken.mock.calls.map((c) => c[0])).toEqual([einsatzKeys.medienkontakte(E)]);
  });

  it('raeumen gibt offene Ziele als Listen an den Sammler und lädt danach nichts mehr', async () => {
    const { qc, sammler, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.schaeden(E), []);
    const vormerken = vi.spyOn(sammler, 'vormerken');

    zeilen.vormerken('schaeden', 2);
    zeilen.raeumen();
    zeilen.vormerken('schaeden', 3);
    await fenster();

    expect(api.ladeSchaden).not.toHaveBeenCalled();
    expect(vormerken.mock.calls.map((c) => c[0])).toEqual([
      einsatzKeys.schaeden(E),
      einsatzKeys.schadenMarker(E),
    ]);
  });
});
