import { describe, expect, it, vi } from 'vitest';
import { QueryObserver, type QueryClient } from '@tanstack/react-query';
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

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    await warte(2);
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
    await warte(2);
    await listeAbrufen(qc, [kopf(7, 1), kopf(8)]);
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(7), alt)).toBe(false);
    expect(lagebildStandZulaessig(qc, einsatzKeys.personen(8), alt)).toBe(true);
  });

  it('verwirft ihn auch, wenn die Liste schon vor der Vorbelegung kam', async () => {
    const qc = neuerClient();
    const alt = Date.now();
    await listeAbrufen(qc, [kopf(7, 1)]);
    await warte(2);
    schwaerzungsWaechterVorbelegen(qc, [eintrag(einsatzKeys.einsatz(7), kopf(7))]);
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
