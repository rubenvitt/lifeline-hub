import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { merkeOrgStand } from './orgListener';
import type { LiveSammler } from './liveInvalidierung';

function sammlerMitProtokoll() {
  const vorgemerkt: unknown[][] = [];
  const sammler: LiveSammler = {
    vormerken: (key) => void vorgemerkt.push([...key]),
    raeumen: () => {},
  };
  return { sammler, vorgemerkt };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('merkeOrgStand (Erst-Open-Abgleich, LLH-1839)', () => {
  it('gleicht beim Erst-Open nicht ab, was erst nach dem Verbindungsaufbau geladen wurde', () => {
    const qc = new QueryClient();
    const { sammler, vorgemerkt } = sammlerMitProtokoll();
    const abgleich = merkeOrgStand(qc);
    vi.advanceTimersByTime(50);
    qc.setQueryData(['einsaetze'], []);
    qc.setQueryData(['etb-bausteine'], []);
    abgleich(sammler);
    expect(vorgemerkt).toEqual([]);
  });

  it('gleicht ab, was schon vor dem Verbindungsaufbau im Cache lag (Wechsel aus dem Org-Strom, LFH-734)', () => {
    const qc = new QueryClient();
    qc.setQueryData(['einsaetze'], []);
    qc.setQueryData(['material', 'alle'], []);
    vi.advanceTimersByTime(50);
    const { sammler, vorgemerkt } = sammlerMitProtokoll();
    const abgleich = merkeOrgStand(qc);
    vi.advanceTimersByTime(50);
    qc.setQueryData(['etb-bausteine'], []);
    abgleich(sammler);
    expect(vorgemerkt).toContainEqual(['einsaetze']);
    expect(vorgemerkt).toContainEqual(['material']);
    expect(vorgemerkt).not.toContainEqual(['etb-bausteine']);
  });

  it('gleicht nicht ab, was beim Verbindungsaufbau erstmals lud (derselbe Seitenaufruf)', async () => {
    const qc = new QueryClient();
    let antworte: (wert: unknown[]) => void = () => {};
    void qc.fetchQuery({
      queryKey: ['einsaetze'],
      queryFn: () => new Promise<unknown[]>((r) => (antworte = r)),
    });
    const { sammler, vorgemerkt } = sammlerMitProtokoll();
    const abgleich = merkeOrgStand(qc);
    vi.advanceTimersByTime(50);
    antworte([]);
    await vi.advanceTimersByTimeAsync(10);
    abgleich(sammler);
    expect(vorgemerkt).toEqual([]);
  });

  it('gleicht ab, was vorher Daten hatte und beim Verbindungsaufbau gerade neu lädt', () => {
    const qc = new QueryClient();
    qc.setQueryData(['einsaetze'], []);
    vi.advanceTimersByTime(50);
    void qc.fetchQuery({
      queryKey: ['einsaetze'],
      queryFn: () => new Promise<unknown[]>(() => {}),
      staleTime: 0,
    });
    const { sammler, vorgemerkt } = sammlerMitProtokoll();
    merkeOrgStand(qc)(sammler);
    expect(vorgemerkt).toContainEqual(['einsaetze']);
  });

  it('merkt einen Org-Key nur einmal vor, auch wenn mehrere Fächer unter ihm veraltet sind', () => {
    const qc = new QueryClient();
    qc.setQueryData(['personal', 'alle'], []);
    qc.setQueryData(['personal', 'aktiv'], []);
    vi.advanceTimersByTime(50);
    const { sammler, vorgemerkt } = sammlerMitProtokoll();
    merkeOrgStand(qc)(sammler);
    expect(vorgemerkt.filter((k) => k[0] === 'personal')).toEqual([['personal']]);
  });
});
