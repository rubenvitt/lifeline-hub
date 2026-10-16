import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { Verpflegung, VerpflegungAusgabeErgebnis } from '../api/types';
import { KEINE_EMPFAENGER, KEINE_SONDERKOST, zeitfenster } from '../test/verpflegungDaten';
import { useAusgabeSammlung, type AusgabeSammlungOptionen } from './useAusgabeSammlung';

const erfasse = vi.fn();
const merkeVor = vi.fn();
vi.mock('../offline/schreiben', () => ({
  erfasseVerpflegungsausgabeOfflineFaehig: (...a: unknown[]) => erfasse(...a),
  merkeVerpflegungsausgabeVor: (...a: unknown[]) => merkeVor(...a),
}));

const MITTAG = { id: 1, bezeichnung: 'Mittag' };
const ABEND = { id: 2, bezeichnung: 'Abend' };

/** Antwort des Servers: das Zeitfenster mit 20 EP mehr ausgegeben. */
function gebucht(ausgabeId: number, mehr = 20): VerpflegungAusgabeErgebnis {
  return {
    ausgabe_id: ausgabeId,
    zeitfenster: zeitfenster({
      ausgegeben: { gesamt: 230 + mehr, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
      fehlmenge: { gesamt: Math.max(0, 20 - mehr), sonderkost: KEINE_SONDERKOST },
    }),
  };
}

function aufbau(start: Partial<AusgabeSammlungOptionen> = {}) {
  const client = new QueryClient();
  client.setQueryData<Verpflegung>(einsatzKeys.verpflegung(1), {
    zeitfenster: [zeitfenster()],
    stellen: [],
    empfaenger: KEINE_EMPFAENGER,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onGebucht = vi.fn();
  const onVorgemerkt = vi.fn();
  /** Je Render: Sammlung und ausgegebene Menge im Cache — ihre Summe darf nie sinken. */
  const verlauf: Array<{ sammlung: number; ausgegeben: number }> = [];
  const hook = renderHook(
    (props: Partial<AusgabeSammlungOptionen>) => {
      const s = useAusgabeSammlung({
        benutzerId: 5,
        einsatzId: 1,
        zeitfenster: MITTAG,
        vergangen: false,
        onGebucht,
        onVorgemerkt,
        ...props,
      });
      const qc = useQueryClient();
      const daten = qc.getQueryData<Verpflegung>(einsatzKeys.verpflegung(1));
      verlauf.push({ sammlung: s.menge, ausgegeben: daten?.zeitfenster[0].ausgegeben.gesamt ?? 0 });
      return s;
    },
    { wrapper, initialProps: start },
  );
  return { ...hook, client, onGebucht, onVorgemerkt, verlauf };
}

function tippe(r: { current: ReturnType<typeof useAusgabeSammlung> }, n = 1, mal = 1) {
  for (let i = 0; i < mal; i++) act(() => r.current.tippe(n));
}

describe('useAusgabeSammlung (LLH-1032, design.md D2/D5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:30:00Z'));
    erfasse.mockReset();
    merkeVor.mockReset();
    merkeVor.mockResolvedValue({ zustand: 'vorgemerkt', client_id: 'x' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('20 × „+1“: keine Anfrage vor 3 s, danach genau eine über 20 EP ohne Zeitpunkt (AK 1)', async () => {
    erfasse.mockResolvedValue({ zustand: 'gesendet', daten: gebucht(55) });
    const { result } = aufbau();
    tippe(result, 1, 20);
    expect(result.current.menge).toBe(20);
    await act(async () => vi.advanceTimersByTime(2999));
    expect(erfasse).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(erfasse).toHaveBeenCalledTimes(1);
    expect(erfasse).toHaveBeenCalledWith(5, 1, MITTAG, { menge: 20 });
    expect(merkeVor).not.toHaveBeenCalled();
  });

  it('Tipps alle 2 s: Abschluss nach 15 s, der nächste Tipp beginnt eine neue Sammlung', async () => {
    erfasse.mockResolvedValue({ zustand: 'gesendet', daten: gebucht(55, 8) });
    const { result } = aufbau();
    for (let t = 0; t < 8; t++) {
      tippe(result);
      await act(async () => vi.advanceTimersByTime(t < 7 ? 2000 : 999));
    }
    // 14 999 ms nach dem ersten Tipp: noch offen.
    expect(erfasse).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(erfasse).toHaveBeenCalledTimes(1);
    expect(erfasse.mock.calls[0][3]).toEqual({ menge: 8 });
    tippe(result);
    expect(result.current.offen).toBe(true);
  });

  it('„Menge …“ 60 bucht sofort', async () => {
    erfasse.mockResolvedValue({ zustand: 'gesendet', daten: gebucht(55, 60) });
    const { result } = aufbau();
    await act(async () => result.current.tippe(60));
    expect(erfasse).toHaveBeenCalledWith(5, 1, MITTAG, { menge: 60 });
  });

  it('Sonderkost-Tipp zählt Kostform und Menge in eine Ausgabe (AK 3)', async () => {
    erfasse.mockResolvedValue({ zustand: 'gesendet', daten: gebucht(55, 5) });
    const { result } = aufbau();
    tippe(result, 1, 3);
    act(() => result.current.tippe(1, 'vegetarisch'));
    act(() => result.current.tippe(1, 'vegetarisch'));
    expect(result.current.sonderkost.vegetarisch).toBe(2);
    await act(async () => result.current.buchen());
    expect(erfasse).toHaveBeenCalledWith(5, 1, MITTAG, {
      menge: 5,
      sonderkost: { vegetarisch: 2 },
    });
  });

  it('Wechsel des Zeitfensters merkt die Sammlung für das alte vor, ohne Sendeversuch', async () => {
    const { result, rerender, onVorgemerkt } = aufbau();
    tippe(result, 1, 4);
    rerender({ zeitfenster: ABEND });
    expect(merkeVor).toHaveBeenCalledWith(5, 1, MITTAG, { menge: 4 });
    expect(result.current.menge).toBe(0);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(erfasse).not.toHaveBeenCalled();
    // Ohne Hinweis (D5).
    expect(onVorgemerkt).not.toHaveBeenCalled();
  });

  it('Wechsel des Zeitfensters bei laufender Anfrage: das gesendete Bündel zählt nur beim alten', async () => {
    let antwort!: (v: unknown) => void;
    erfasse.mockImplementationOnce(() => new Promise((r) => (antwort = r)));
    const { result, rerender } = aufbau();
    act(() => result.current.tippe(1, 'vegetarisch'));
    tippe(result, 1, 2);
    await act(async () => result.current.buchen());
    expect(result.current.menge).toBe(3);
    rerender({ zeitfenster: ABEND });
    expect(result.current.menge).toBe(0);
    expect(result.current.sonderkost.vegetarisch).toBe(0);
    // Zurück, solange die Antwort aussteht: dort zählt es wieder.
    rerender({ zeitfenster: MITTAG });
    expect(result.current.menge).toBe(3);
    await act(async () => antwort({ zustand: 'gesendet', daten: gebucht(55, 3) }));
    expect(result.current.menge).toBe(0);
  });

  it('Unmount merkt die Sammlung vor, ohne Sendeversuch und ohne Hinweis', async () => {
    const { result, unmount, onVorgemerkt } = aufbau();
    tippe(result, 1, 4);
    unmount();
    expect(merkeVor).toHaveBeenCalledWith(5, 1, MITTAG, { menge: 4 });
    await act(async () => vi.advanceTimersByTime(5000));
    expect(erfasse).not.toHaveBeenCalled();
    expect(onVorgemerkt).not.toHaveBeenCalled();
  });

  it('`visibilitychange` → hidden merkt vor, ohne Sendeversuch', async () => {
    const { result } = aufbau();
    tippe(result, 1, 7);
    const sicht = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    } finally {
      sicht.mockRestore();
    }
    expect(merkeVor).toHaveBeenCalledWith(5, 1, MITTAG, { menge: 7 });
    await act(async () => vi.advanceTimersByTime(5000));
    expect(erfasse).not.toHaveBeenCalled();
  });

  it('`visibilitychange` → visible lässt die Sammlung offen', () => {
    const { result } = aufbau();
    tippe(result, 1, 2);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(merkeVor).not.toHaveBeenCalled();
    expect(result.current.menge).toBe(2);
  });

  it('Ruhe-Zeitgeber und `pagehide` im selben Takt ergeben genau einen Schreibvorgang', async () => {
    erfasse.mockResolvedValue({ zustand: 'gesendet', daten: gebucht(55) });
    const { result } = aufbau();
    tippe(result, 1, 3);
    // Die Uhr steht schon hinter der Ruhe, der Zeitgeber ist aber noch nicht gelaufen.
    vi.setSystemTime(Date.now() + 3000);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await act(async () => vi.runOnlyPendingTimers());
    expect(merkeVor.mock.calls.length + erfasse.mock.calls.length).toBe(1);
    expect(merkeVor).toHaveBeenCalledWith(5, 1, MITTAG, { menge: 3 });
  });

  it('eine leere Sammlung erzeugt keine Anfrage, auch nicht nach „−1“ auf null', async () => {
    const { result, unmount } = aufbau();
    await act(async () => result.current.buchen());
    tippe(result);
    act(() => result.current.nimmZurueck());
    expect(result.current.offen).toBe(false);
    await act(async () => vi.advanceTimersByTime(20_000));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    unmount();
    expect(erfasse).not.toHaveBeenCalled();
    expect(merkeVor).not.toHaveBeenCalled();
  });

  it('neue Tipps während des Sendens bilden ein zweites, unabhängiges Bündel', async () => {
    let erste!: (v: unknown) => void;
    erfasse
      .mockImplementationOnce(() => new Promise((r) => (erste = r)))
      .mockResolvedValueOnce({ zustand: 'gesendet', daten: gebucht(56, 2) });
    const { result } = aufbau();
    tippe(result, 1, 3);
    await act(async () => result.current.buchen());
    tippe(result, 1, 2);
    // Gesendet und offen zählen beide in „Sammlung“.
    expect(result.current.menge).toBe(5);
    await act(async () => result.current.buchen());
    expect(erfasse).toHaveBeenCalledTimes(2);
    expect(erfasse.mock.calls[0][3]).toEqual({ menge: 3 });
    expect(erfasse.mock.calls[1][3]).toEqual({ menge: 2 });
    await act(async () => erste({ zustand: 'gesendet', daten: gebucht(55, 3) }));
    expect(result.current.menge).toBe(0);
  });

  it('während der Anfrage zählt „Sammlung“ weiter, danach steht die Menge in „ausgegeben“ ohne kleineren Zwischenstand', async () => {
    let antwort!: (v: unknown) => void;
    erfasse.mockImplementation(() => new Promise((r) => (antwort = r)));
    const { result, onGebucht, verlauf } = aufbau();
    tippe(result, 1, 20);
    await act(async () => vi.advanceTimersByTime(3000));
    expect(erfasse).toHaveBeenCalledTimes(1);
    expect(result.current.menge).toBe(20);
    expect(result.current.offen).toBe(false);
    await act(async () => antwort({ zustand: 'gesendet', daten: gebucht(55) }));
    expect(result.current.menge).toBe(0);
    expect(onGebucht).toHaveBeenCalledWith(55, { menge: 20 });
    // Ab dem ersten Tipp: Sammlung + ausgegeben sinkt nie.
    const summen = verlauf
      .filter((v) => v.sammlung > 0 || v.ausgegeben > 230)
      .map((v) => v.sammlung + v.ausgegeben);
    for (let i = 1; i < summen.length; i++) expect(summen[i]).toBeGreaterThanOrEqual(summen[i - 1]);
    expect(summen[summen.length - 1]).toBe(250);
  });

  it('ohne Netz vorgemerkt: Hinweis-Rückruf statt „Gebucht“', async () => {
    erfasse.mockResolvedValue({ zustand: 'vorgemerkt', client_id: 'c1' });
    const { result, onGebucht, onVorgemerkt } = aufbau();
    tippe(result, 1, 8);
    await act(async () => vi.advanceTimersByTime(3000));
    expect(onVorgemerkt).toHaveBeenCalledWith({ menge: 8 });
    expect(onGebucht).not.toHaveBeenCalled();
    expect(result.current.menge).toBe(0);
  });

  it('eine fachliche Ablehnung steht bis zum nächsten Abschluss', async () => {
    erfasse.mockRejectedValueOnce(new ApiError(409, 'Einsatz abgeschlossen'));
    const { result } = aufbau();
    tippe(result, 1, 4);
    await act(async () => result.current.buchen());
    expect(result.current.ablehnung?.buendel).toEqual({ menge: 4 });
    expect(result.current.menge).toBe(0);
    erfasse.mockImplementationOnce(() => new Promise(() => {}));
    tippe(result);
    expect(result.current.ablehnung).not.toBeNull();
    await act(async () => result.current.buchen());
    expect(result.current.ablehnung).toBeNull();
  });

  it('eine Ablehnung nach dem Wechsel des Zeitfensters erscheint nicht am neuen Ort', async () => {
    let ablehnen!: (e: unknown) => void;
    erfasse.mockImplementationOnce(() => new Promise((_, r) => (ablehnen = r)));
    const { result, rerender } = aufbau();
    tippe(result, 1, 4);
    await act(async () => result.current.buchen());
    rerender({ zeitfenster: ABEND });
    await act(async () => ablehnen(new ApiError(409, 'Einsatz abgeschlossen')));
    expect(result.current.ablehnung).toBeNull();
  });

  it('wird das Zeitfenster während der Sammlung vergangen, wird sie gebucht', async () => {
    erfasse.mockResolvedValue({ zustand: 'gesendet', daten: gebucht(55, 2) });
    const { result, rerender } = aufbau();
    tippe(result, 1, 2);
    rerender({ vergangen: true });
    expect(erfasse).toHaveBeenCalledWith(5, 1, MITTAG, { menge: 2 });
    // Vergangen zählt nicht mehr.
    act(() => result.current.tippe(1));
    expect(result.current.offen).toBe(false);
  });
});
