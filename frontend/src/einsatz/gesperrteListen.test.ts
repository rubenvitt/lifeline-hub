import { QueryClient, QueryObserver, dehydrate, hydrate } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { EINSATZ_KEYS, einsatzKeys } from '../api/queryKeys';
import {
  istLagebildGesperrt,
  lagebildDehydrierOptionen,
  lagebildEntsperren,
  lagebildStandZulaessig,
} from '../offline/lagebildFilter';
import { freigabenFixture } from '../test/fixtures';
import { raeumeGesperrteListen } from './gesperrteListen';

const EINSATZ = 7;
const GESPERRT = { zugriff: false };

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

describe('raeumeGesperrteListen (LLH-1462)', () => {
  it('räumt nach dem Entzug die Liste und ihren Zeitachsen-Anteil, nicht die freien', () => {
    const qc = client();
    qc.setQueryData(einsatzKeys.personal(EINSATZ), [{ id: 1 }]);
    qc.setQueryData([EINSATZ_KEYS.kraefteZeitachse, EINSATZ, 'personal', 1], { punkte: [] });
    qc.setQueryData([EINSATZ_KEYS.kraefteZeitachse, EINSATZ, 'einheiten', 1], { punkte: [] });
    qc.setQueryData(einsatzKeys.fahrzeuge(EINSATZ), [{ id: 2 }]);
    qc.setQueryData(einsatzKeys.personal(EINSATZ + 1), [{ id: 3 }]);

    raeumeGesperrteListen(qc, EINSATZ, freigabenFixture({ personal: GESPERRT }));

    expect(qc.getQueryData(einsatzKeys.personal(EINSATZ))).toBeUndefined();
    expect(
      qc.getQueryData([EINSATZ_KEYS.kraefteZeitachse, EINSATZ, 'personal', 1]),
    ).toBeUndefined();
    expect(qc.getQueryData([EINSATZ_KEYS.kraefteZeitachse, EINSATZ, 'einheiten', 1])).toEqual({
      punkte: [],
    });
    expect(qc.getQueryData(einsatzKeys.fahrzeuge(EINSATZ))).toEqual([{ id: 2 }]);
    // Ein anderer Einsatz bleibt unberührt.
    expect(qc.getQueryData(einsatzKeys.personal(EINSATZ + 1))).toEqual([{ id: 3 }]);
    expect(istLagebildGesperrt(qc, einsatzKeys.personal(EINSATZ))).toBe(true);
    expect(istLagebildGesperrt(qc, einsatzKeys.fahrzeuge(EINSATZ))).toBe(false);
    expect(istLagebildGesperrt(qc, [EINSATZ_KEYS.kraefteZeitachse, EINSATZ, 'personal', 1])).toBe(
      true,
    );
    expect(istLagebildGesperrt(qc, [EINSATZ_KEYS.kraefteZeitachse, EINSATZ, 'einheiten', 1])).toBe(
      false,
    );
  });

  it('nimmt einer beobachteten, abgeschalteten Liste die Daten, ohne neu zu fragen', async () => {
    const qc = client();
    const queryFn = vi.fn(async () => [{ id: 9 }]);
    qc.setQueryData(einsatzKeys.einheiten(EINSATZ), [{ id: 1 }]);
    const observer = new QueryObserver(qc, {
      queryKey: einsatzKeys.einheiten(EINSATZ),
      queryFn,
      enabled: false,
    });
    const abmelden = observer.subscribe(() => {});

    raeumeGesperrteListen(qc, EINSATZ, freigabenFixture({ einheiten: GESPERRT }));
    await Promise.resolve();

    const stand = observer.getCurrentResult();
    expect(stand.data).toBeUndefined();
    expect(stand.isPending).toBe(true);
    expect(queryFn).not.toHaveBeenCalled();
    abmelden();
  });

  it('verwirft die späte Antwort eines Abrufs von vor dem Entzug', async () => {
    const qc = client();
    let antworte: (daten: { id: number }[]) => void = () => {};
    const spaet = new Promise<{ id: number }[]>((r) => (antworte = r));
    qc.setQueryData(einsatzKeys.personal(EINSATZ), [{ id: 1 }]);
    const observer = new QueryObserver(qc, {
      queryKey: einsatzKeys.personal(EINSATZ),
      queryFn: () => spaet,
      enabled: false,
    });
    const abmelden = observer.subscribe(() => {});
    // Der Abruf lief schon, als die Freigabe fiel.
    void observer.refetch();
    expect(qc.getQueryState(einsatzKeys.personal(EINSATZ))?.fetchStatus).toBe('fetching');

    raeumeGesperrteListen(qc, EINSATZ, freigabenFixture({ personal: GESPERRT }));
    antworte([{ id: 2 }]);
    await new Promise((r) => setTimeout(r, 0));

    expect(qc.getQueryData(einsatzKeys.personal(EINSATZ))).toBeUndefined();
    expect(observer.getCurrentResult().data).toBeUndefined();
    abmelden();
  });

  it('lässt eine noch ungeprüft abfragende Seite neu fragen', async () => {
    const qc = client();
    const queryFn = vi.fn(async () => [{ id: 9 }]);
    qc.setQueryData(einsatzKeys.material(EINSATZ), [{ id: 1 }]);
    const observer = new QueryObserver(qc, {
      queryKey: einsatzKeys.material(EINSATZ),
      queryFn,
      staleTime: Infinity,
    });
    const abmelden = observer.subscribe(() => {});

    raeumeGesperrteListen(qc, EINSATZ, freigabenFixture({ material: GESPERRT }));

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    abmelden();
  });

  it('nimmt Liste und Entlassene aus Anzeige, Cache und Offline-Stand', () => {
    const qc = client();
    qc.setQueryData(einsatzKeys.personal(EINSATZ), [{ id: 1 }]);
    qc.setQueryData(einsatzKeys.personalEntlassene(EINSATZ), [{ id: 4 }]);
    qc.setQueryData(einsatzKeys.fahrzeuge(EINSATZ), [{ id: 2 }]);
    // Die Liste steht auf der Seite, die Entlassenen nur im Cache.
    const observer = new QueryObserver(qc, {
      queryKey: einsatzKeys.personal(EINSATZ),
      queryFn: async () => [{ id: 9 }],
      enabled: false,
    });
    const abmelden = observer.subscribe(() => {});
    const vorher = dehydrate(qc, lagebildDehydrierOptionen(qc)).queries.map((q) => q.queryKey);
    expect(vorher).toContainEqual(einsatzKeys.personalEntlassene(EINSATZ));

    raeumeGesperrteListen(qc, EINSATZ, freigabenFixture({ personal: GESPERRT }));

    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(qc.getQueryData(einsatzKeys.personalEntlassene(EINSATZ))).toBeUndefined();
    // Auch ein danach noch gesetzter Stand ginge nicht auf die Platte.
    qc.setQueryData(einsatzKeys.personalEntlassene(EINSATZ), [{ id: 5 }]);
    const stand = dehydrate(qc, lagebildDehydrierOptionen(qc));
    const keys = stand.queries.map((q) => q.queryKey);
    expect(keys).not.toContainEqual(einsatzKeys.personal(EINSATZ));
    expect(keys).not.toContainEqual(einsatzKeys.personalEntlassene(EINSATZ));
    expect(keys).toContainEqual(einsatzKeys.fahrzeuge(EINSATZ));

    // Die Wiederherstellung aus diesem Stand bringt nichts davon zurück.
    const neu = client();
    hydrate(neu, stand);
    expect(neu.getQueryData(einsatzKeys.personal(EINSATZ))).toBeUndefined();
    expect(neu.getQueryData(einsatzKeys.personalEntlassene(EINSATZ))).toBeUndefined();
    expect(neu.getQueryData(einsatzKeys.fahrzeuge(EINSATZ))).toEqual([{ id: 2 }]);
    abmelden();
  });

  it('sperrt auch einen Stand, der nur im Vorrat der Sitzung liegt', () => {
    const qc = client();
    // Kein Material im Cache: die Seite war nie offen, der Stand kam nur von der Platte.
    raeumeGesperrteListen(qc, EINSATZ, freigabenFixture({ material: GESPERRT }));
    expect(lagebildStandZulaessig(qc, einsatzKeys.material(EINSATZ), Date.now())).toBe(false);
    expect(lagebildStandZulaessig(qc, einsatzKeys.fahrzeuge(EINSATZ), Date.now())).toBe(true);
  });

  it('sperrt nur den Zeitachsen-Anteil des gesperrten Moduls, bis er wieder lädt', () => {
    const qc = client();
    const personalAchse = [EINSATZ_KEYS.kraefteZeitachse, EINSATZ, 'personal', 1];
    const einheitenAchse = [EINSATZ_KEYS.kraefteZeitachse, EINSATZ, 'einheiten', 1];

    raeumeGesperrteListen(qc, EINSATZ, freigabenFixture({ personal: GESPERRT }));

    expect(lagebildStandZulaessig(qc, personalAchse, Date.now())).toBe(false);
    expect(lagebildStandZulaessig(qc, einheitenAchse, Date.now())).toBe(true);
    // Erst ein Abruf-Erfolg der Zeitachse selbst hebt ihre Marke auf, nicht der der Liste.
    lagebildEntsperren(qc, einsatzKeys.personal(EINSATZ));
    expect(istLagebildGesperrt(qc, personalAchse)).toBe(true);
    lagebildEntsperren(qc, personalAchse);
    expect(istLagebildGesperrt(qc, personalAchse)).toBe(false);
  });

  it('lässt bei vollen Freigaben alles stehen', () => {
    const qc = client();
    qc.setQueryData(einsatzKeys.personal(EINSATZ), [{ id: 1 }]);
    raeumeGesperrteListen(qc, EINSATZ, freigabenFixture());
    expect(qc.getQueryData(einsatzKeys.personal(EINSATZ))).toEqual([{ id: 1 }]);
    expect(istLagebildGesperrt(qc, einsatzKeys.personal(EINSATZ))).toBe(false);
  });
});
