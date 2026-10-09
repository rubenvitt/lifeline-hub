import { describe, expect, it, vi } from 'vitest';
import { QueryObserver, dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { erzeugeQueryClient } from '../api/queryClient';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { istLagebildGesperrt, lagebildStandZulaessig } from './lagebildFilter';
import { schwaerzungsWaechterVorbelegen } from './schwaerzungsWaechter';

/**
 * Wächter der Schwärzung (LFH-996, design.md D3–D5): ein höherer `teilschwaerzungen` im Kopf
 * oder in der Einsatzliste verwirft ältere Stände des Einsatzes, ein aus der Liste
 * verschwundener Einsatz wird geräumt wie beim 404 auf den Kopf.
 */

/**
 * Wartet, bis `Date.now()` über dem Stand beim Aufruf liegt. Jeder danach gesetzte
 * `dataUpdatedAt` ist dann echt jünger als jeder davor. `hydrate` übernimmt nur einen echt
 * jüngeren Stand; ein fester `setTimeout` reicht dafür nicht, weil Node Timer gegen die gecachte
 * Loop-Zeit misst und nicht gegen `Date.now()`. Unter Last bekamen beide Abrufe sonst dieselbe
 * Millisekunde.
 */
async function naechsteMillisekunde(): Promise<void> {
  const jetzt = Date.now();
  while (Date.now() <= jetzt) await new Promise((r) => setTimeout(r, 1));
}

function neuerClient() {
  return erzeugeQueryClient({ queries: { retry: false } });
}

function kopf(id: number, teilschwaerzungen?: number) {
  return teilschwaerzungen === undefined ? { id } : { id, teilschwaerzungen };
}

async function kopfAbrufen(qc: QueryClient, id: number, teilschwaerzungen?: number) {
  await qc.fetchQuery({
    queryKey: einsatzKeys.einsatz(id),
    queryFn: async () => kopf(id, teilschwaerzungen),
    staleTime: 0,
  });
}

async function listeAbrufen(qc: QueryClient, eintraege: ReturnType<typeof kopf>[]) {
  await qc.fetchQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: async () => eintraege,
    staleTime: 0,
  });
}

function beobachten(qc: QueryClient, queryKey: readonly unknown[], queryFn: () => unknown) {
  return new QueryObserver(qc, { queryKey, queryFn, retry: false }).subscribe(() => {});
}

describe('Schwärzungswächter — Stand im Einsatzkopf', () => {
  it('räumt bei höherem Stand unbeobachtete Stände des Einsatzes und ruft beobachtete neu ab', async () => {
    const qc = neuerClient();
    await kopfAbrufen(qc, 7);
    qc.setQueryData(einsatzKeys.personen(7), [{ id: 1, name: 'Muster' }]);
    qc.setQueryData(einsatzKeys.personen(8), [{ id: 2, name: 'Nachbar' }]);
    const detail = vi.fn(async () => ({ id: 1, name: 'Muster' }));
    const ab = beobachten(qc, einsatzKeys.person(7, 1), detail);
    await vi.waitFor(() => expect(detail).toHaveBeenCalledTimes(1));

    await kopfAbrufen(qc, 7, 1);

    expect(qc.getQueryData(einsatzKeys.personen(7))).toBeUndefined();
    expect(qc.getQueryData(einsatzKeys.personen(8))).toEqual([{ id: 2, name: 'Nachbar' }]);
    expect(qc.getQueryData(einsatzKeys.einsatz(7))).toEqual(kopf(7, 1));
    await vi.waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
    ab();
  });

  it('verwirft einen laufenden Erstabruf, der vor der Schwärzung beantwortet wurde', async () => {
    const qc = neuerClient();
    await kopfAbrufen(qc, 7);
    let alteAntwort: (v: unknown) => void = () => {};
    const personen = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise((r) => (alteAntwort = r)))
      .mockResolvedValue([]);
    const ab = beobachten(qc, einsatzKeys.personen(7), personen);
    await vi.waitFor(() => expect(personen).toHaveBeenCalledTimes(1));

    await kopfAbrufen(qc, 7, 1);
    alteAntwort([{ id: 1, name: 'Muster' }]);

    await vi.waitFor(() => expect(personen).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(qc.getQueryData(einsatzKeys.personen(7))).toEqual([]));
    ab();
  });

  it('wertet einen Stand aus `hydrate` nicht als Schwärzung', async () => {
    const qc = neuerClient();
    await kopfAbrufen(qc, 7);
    qc.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    const quelle = neuerClient();
    await naechsteMillisekunde();
    await kopfAbrufen(quelle, 7, 1);
    hydrate(qc, dehydrate(quelle));
    expect(qc.getQueryData(einsatzKeys.einsatz(7))).toEqual(kopf(7, 1));
    expect(qc.getQueryData(einsatzKeys.personen(7))).toEqual([{ id: 1 }]);
  });

  it('räumt nichts bei gleichem Stand', async () => {
    const qc = neuerClient();
    await kopfAbrufen(qc, 7, 1);
    qc.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    await kopfAbrufen(qc, 7, 1);
    expect(qc.getQueryData(einsatzKeys.personen(7))).toEqual([{ id: 1 }]);
  });

  it('räumt nichts beim ersten Sehen eines Einsatzes, auch mit Stand', async () => {
    const qc = neuerClient();
    qc.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    await kopfAbrufen(qc, 7, 3);
    expect(qc.getQueryData(einsatzKeys.personen(7))).toEqual([{ id: 1 }]);
  });

  it('hält einen älteren Stand von der Platte fern, einen jüngeren nicht', async () => {
    const qc = neuerClient();
    await kopfAbrufen(qc, 7);
    const vorher = Date.now() - 1;
    await naechsteMillisekunde();
    await kopfAbrufen(qc, 7, 1);
    const marke = qc.getQueryState(einsatzKeys.einsatz(7))!.dataUpdatedAt;
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(7), vorher)).toBe(false);
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(7), marke)).toBe(true);
    expect(lagebildStandZulaessig(qc, einsatzKeys.einsatz(7), marke)).toBe(true);
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(8), vorher)).toBe(true);
  });
});

describe('Schwärzungswächter — Einsatzliste', () => {
  it('räumt bei höherem Stand in der Liste wie beim Kopf', async () => {
    const qc = neuerClient();
    await listeAbrufen(qc, [kopf(7), kopf(8)]);
    qc.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    qc.setQueryData(einsatzKeys.personen(8), [{ id: 2 }]);
    await listeAbrufen(qc, [kopf(7, 1), kopf(8)]);
    expect(qc.getQueryData(einsatzKeys.personen(7))).toBeUndefined();
    expect(qc.getQueryData(einsatzKeys.personen(8))).toEqual([{ id: 2 }]);
  });

  it('ruft einen älteren Kopf neu ab, wenn die Liste den höheren Stand zuerst trägt', async () => {
    const qc = neuerClient();
    const kopfAbruf = vi.fn(async () => kopf(7, 1));
    await qc.fetchQuery({ queryKey: einsatzKeys.einsatz(7), queryFn: async () => kopf(7) });
    await listeAbrufen(qc, [kopf(7)]);
    await naechsteMillisekunde();
    qc.getQueryCache()
      .find({ queryKey: einsatzKeys.einsatz(7) })!
      .setOptions({
        queryKey: einsatzKeys.einsatz(7),
        queryFn: kopfAbruf,
      });
    await listeAbrufen(qc, [kopf(7, 1)]);
    await vi.waitFor(() => expect(kopfAbruf).toHaveBeenCalledTimes(1));
    const marke = qc.getQueryState(globalKeys.einsaetze())!.dataUpdatedAt;
    const kopfStand = qc.getQueryState(einsatzKeys.einsatz(7))!.dataUpdatedAt;
    expect(lagebildStandZulaessig(qc, einsatzKeys.einsatz(7), kopfStand)).toBe(true);
    expect(kopfStand).toBeGreaterThanOrEqual(marke);
  });

  it('vergleicht eine Liste aus `hydrate` nicht mit der vorigen', async () => {
    const qc = neuerClient();
    await listeAbrufen(qc, [kopf(7), kopf(8)]);
    qc.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    const quelle = neuerClient();
    await naechsteMillisekunde();
    await listeAbrufen(quelle, [kopf(8)]);
    hydrate(qc, dehydrate(quelle));
    expect(qc.getQueryData(globalKeys.einsaetze())).toEqual([kopf(8)]);
    expect(qc.getQueryData(einsatzKeys.personen(7))).toEqual([{ id: 1 }]);
    expect(istLagebildGesperrt(qc, einsatzKeys.personen(7))).toBe(false);
  });

  it('räumt einen verschwundenen Einsatz und sperrt ihn für die Platte', async () => {
    const qc = neuerClient();
    await listeAbrufen(qc, [kopf(7), kopf(8)]);
    qc.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    qc.setQueryData(einsatzKeys.personen(8), [{ id: 2 }]);
    await listeAbrufen(qc, [kopf(8)]);
    expect(qc.getQueryData(einsatzKeys.personen(7))).toBeUndefined();
    expect(istLagebildGesperrt(qc, einsatzKeys.personen(7))).toBe(true);
    expect(qc.getQueryData(einsatzKeys.personen(8))).toEqual([{ id: 2 }]);
    expect(istLagebildGesperrt(qc, einsatzKeys.personen(8))).toBe(false);
  });

  it('ruft den beobachteten Kopf eines verschwundenen Einsatzes neu ab, den Rest räumt der 404', async () => {
    const qc = neuerClient();
    await listeAbrufen(qc, [kopf(7)]);
    const kopfAbruf = vi.fn(async () => kopf(7));
    const ab = beobachten(qc, einsatzKeys.einsatz(7), kopfAbruf);
    await vi.waitFor(() => expect(kopfAbruf).toHaveBeenCalledTimes(1));
    kopfAbruf.mockImplementation(() => Promise.reject(new ApiError(404, 'weg')));
    await listeAbrufen(qc, []);
    await vi.waitFor(() => expect(kopfAbruf).toHaveBeenCalledTimes(2));
    ab();
  });

  it('lässt einen Einsatz stehen, den die vorige Liste nicht kannte', async () => {
    const qc = neuerClient();
    await listeAbrufen(qc, [kopf(8)]);
    qc.setQueryData(einsatzKeys.personen(9), [{ id: 3 }]);
    await listeAbrufen(qc, [kopf(8)]);
    expect(qc.getQueryData(einsatzKeys.personen(9))).toEqual([{ id: 3 }]);
    expect(istLagebildGesperrt(qc, einsatzKeys.personen(9))).toBe(false);
  });

  it('löst bei einem Fehlerabruf der Liste nichts aus', async () => {
    const qc = neuerClient();
    await listeAbrufen(qc, [kopf(7)]);
    qc.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    await qc
      .fetchQuery({
        queryKey: globalKeys.einsaetze(),
        queryFn: () => Promise.reject(new ApiError(500, 'kaputt')),
        staleTime: 0,
      })
      .catch(() => {});
    expect(qc.getQueryData(einsatzKeys.personen(7))).toEqual([{ id: 1 }]);
  });

  it('vergleicht nach dem Leeren des Speichers nicht mit der Liste der Sitzung davor', async () => {
    const qc = neuerClient();
    await listeAbrufen(qc, [kopf(7)]);
    qc.clear();
    await listeAbrufen(qc, [kopf(8)]);
    expect(istLagebildGesperrt(qc, einsatzKeys.personen(7))).toBe(false);
  });
});

describe('Schwärzungswächter — Vorbelegung aus dem Vorrat', () => {
  type Eintrag = Parameters<typeof schwaerzungsWaechterVorbelegen>[1][number];
  const eintrag = (queryKey: readonly unknown[], data: unknown): Eintrag =>
    ({ queryKey, state: { data, dataUpdatedAt: Date.now() } }) as unknown as Eintrag;

  it('verwirft den Vorrat eines Einsatzes, dessen Stand die erste Liste erhöht', async () => {
    const qc = neuerClient();
    const vorrat = [eintrag(einsatzKeys.einsatz(7), kopf(7)), eintrag(einsatzKeys.personen(7), [])];
    const alt = Date.now();
    schwaerzungsWaechterVorbelegen(qc, vorrat);
    await naechsteMillisekunde();
    await listeAbrufen(qc, [kopf(7, 1), kopf(8)]);
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(7), alt)).toBe(false);
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(8), alt)).toBe(true);
  });

  it('verwirft ihn auch, wenn die Liste schon vor der Vorbelegung kam', async () => {
    const qc = neuerClient();
    const alt = Date.now();
    await naechsteMillisekunde();
    await listeAbrufen(qc, [kopf(7, 1)]);
    schwaerzungsWaechterVorbelegen(qc, [eintrag(einsatzKeys.einsatz(7), kopf(7))]);
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(7), alt)).toBe(false);
  });

  it('nimmt je Einsatz den höchsten Stand im Vorrat, in welcher Reihenfolge auch immer', async () => {
    for (const reihe of [
      [eintrag(einsatzKeys.einsatz(7), kopf(7, 1)), eintrag(globalKeys.einsaetze(), [kopf(7)])],
      [eintrag(globalKeys.einsaetze(), [kopf(7)]), eintrag(einsatzKeys.einsatz(7), kopf(7, 1))],
    ]) {
      const qc = neuerClient();
      const alt = Date.now();
      schwaerzungsWaechterVorbelegen(qc, reihe);
      await naechsteMillisekunde();
      await listeAbrufen(qc, [kopf(7, 1)]);
      expect(lagebildStandZulaessig(qc, einsatzKeys.personen(7), alt)).toBe(true);
    }
  });

  it('zählt einen Einsatz ohne Kopf und Liste im Vorrat als Stand 0', async () => {
    const qc = neuerClient();
    const alt = Date.now();
    schwaerzungsWaechterVorbelegen(qc, [eintrag(einsatzKeys.personen(7), [{ id: 1 }])]);
    await naechsteMillisekunde();
    await listeAbrufen(qc, [kopf(7, 1)]);
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(7), alt)).toBe(false);
  });

  it('lässt den Live-Kopf auf der Platte, der den höheren Stand vor der Vorbelegung trug', async () => {
    const qc = neuerClient();
    const alt = Date.now();
    await naechsteMillisekunde();
    await kopfAbrufen(qc, 7, 1);
    const live = qc.getQueryState(einsatzKeys.einsatz(7))!.dataUpdatedAt;
    await naechsteMillisekunde();
    schwaerzungsWaechterVorbelegen(qc, [eintrag(einsatzKeys.einsatz(7), kopf(7))]);
    expect(lagebildStandZulaessig(qc, einsatzKeys.einsatz(7), live)).toBe(true);
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(7), alt)).toBe(false);
  });

  it('räumt einen Einsatz, den die Liste im Vorrat kannte und die neue nicht mehr', async () => {
    const qc = neuerClient();
    schwaerzungsWaechterVorbelegen(qc, [eintrag(globalKeys.einsaetze(), [kopf(7), kopf(8)])]);
    await listeAbrufen(qc, [kopf(8)]);
    expect(istLagebildGesperrt(qc, einsatzKeys.personen(7))).toBe(true);
    expect(istLagebildGesperrt(qc, einsatzKeys.personen(8))).toBe(false);
  });
});
