import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { erzeugeLiveSammler, LIVE_SAMMELFENSTER_MS } from './liveInvalidierung';

/** Setzt `document.visibilityState`, wie der Browser es beim Verdecken des Tabs tut. */
function sichtbarkeit(wert: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => wert });
}

beforeEach(() => {
  vi.useFakeTimers();
  sichtbarkeit('visible');
});

afterEach(() => {
  vi.useRealTimers();
  sichtbarkeit('visible');
});

function aufbau() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
  return { qc, spy, sammler: erzeugeLiveSammler(qc) };
}

describe('erzeugeLiveSammler (LFH-922)', () => {
  it('das Sammelfenster liegt im Ticketrahmen von 250 bis 500 ms', () => {
    expect(LIVE_SAMMELFENSTER_MS).toBe(300);
  });

  it('invalidiert denselben Key nach dem Fenster genau einmal, ohne laufende Abrufe abzubrechen', () => {
    const { spy, sammler } = aufbau();
    for (let i = 0; i < 50; i += 1) sammler.vormerken(['etb', 1]);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS - 1);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      { queryKey: ['etb', 1], refetchType: 'active' },
      { cancelRefetch: false },
    );
  });

  it('invalidiert verschiedene Keys je einmal', () => {
    const { spy, sammler } = aufbau();
    sammler.vormerken(['etb', 1]);
    sammler.vormerken(['einsaetze']);
    sammler.vormerken(['etb', 1]);
    sammler.vormerken(['etb', 2]);
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toEqual([
      ['etb', 1],
      ['einsaetze'],
      ['etb', 2],
    ]);
  });

  it('hält das Fenster fest: ein Dauerstrom verschiebt den Abgleich nicht', () => {
    const { spy, sammler } = aufbau();
    sammler.vormerken(['etb', 1]);
    vi.advanceTimersByTime(200);
    sammler.vormerken(['etb', 1]);
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    // Was danach kommt, öffnet ein neues Fenster.
    sammler.vormerken(['etb', 1]);
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('ein verdeckter Tab markiert nur, ruft aber nicht ab', () => {
    const { spy, sammler } = aufbau();
    sichtbarkeit('hidden');
    sammler.vormerken(['etb', 1]);
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(
      { queryKey: ['etb', 1], refetchType: 'none' },
      { cancelRefetch: false },
    );
  });

  it('liest die Sichtbarkeit am Ende des Fensters, nicht beim Ereignis', () => {
    const { spy, sammler } = aufbau();
    sammler.vormerken(['etb', 1]);
    sichtbarkeit('hidden');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(
      { queryKey: ['etb', 1], refetchType: 'none' },
      { cancelRefetch: false },
    );
  });

  it('räumen vor dem Ablauf verwirft das Vorgemerkte', () => {
    const { spy, sammler } = aufbau();
    sammler.vormerken(['etb', 1]);
    sammler.raeumen();
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS * 2);
    expect(spy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('markiert die Abfrage tatsächlich als veraltet', () => {
    const qc = new QueryClient();
    qc.setQueryData(['etb', 1], []);
    const sammler = erzeugeLiveSammler(qc);
    sammler.vormerken(['etb', 1]);
    expect(qc.getQueryState(['etb', 1])?.isInvalidated).toBe(false);
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(qc.getQueryState(['etb', 1])?.isInvalidated).toBe(true);
  });
});
