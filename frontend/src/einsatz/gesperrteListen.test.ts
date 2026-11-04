import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { EINSATZ_KEYS, einsatzKeys } from '../api/queryKeys';
import { istLagebildGesperrt } from '../offline/lagebildFilter';
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

  it('lässt bei vollen Freigaben alles stehen', () => {
    const qc = client();
    qc.setQueryData(einsatzKeys.personal(EINSATZ), [{ id: 1 }]);
    raeumeGesperrteListen(qc, EINSATZ, freigabenFixture());
    expect(qc.getQueryData(einsatzKeys.personal(EINSATZ))).toEqual([{ id: 1 }]);
    expect(istLagebildGesperrt(qc, einsatzKeys.personal(EINSATZ))).toBe(false);
  });
});
