import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { neuerQueryClient } from '../test/utils';
import { useFehlerOhneDaten } from './useFehlerOhneDaten';

/** Ein Abruf, dessen Antworten der Test von Hand auslöst, einer nach dem anderen. */
function steuerbarerAbruf() {
  const offen: { resolve: (v: string[]) => void; reject: (e: Error) => void }[] = [];
  return {
    queryFn: () =>
      new Promise<string[]>((resolve, reject) => {
        offen.push({ resolve, reject });
      }),
    get anzahl() {
      return offen.length;
    },
    scheitere: (i: number, e: Error) => offen[i].reject(e),
    liefere: (i: number, v: string[]) => offen[i].resolve(v),
  };
}

/**
 * Wie auf der Stab-Seite: die Seite beobachtet den Schlüssel sofort, ein zweiter Beobachter
 * (`useNetzQuellen`) erst, wenn seine Freigabe da ist.
 */
function zweiBeobachter(abruf: ReturnType<typeof steuerbarerAbruf>) {
  const client = neuerQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ zweiterFrei }: { zweiterFrei: boolean }) => {
      const seite = useQuery({ queryKey: ['stab'], queryFn: abruf.queryFn });
      useQuery({ queryKey: ['stab'], queryFn: abruf.queryFn, enabled: zweiterFrei });
      return { seite, fehler: useFehlerOhneDaten(seite) };
    },
    { wrapper, initialProps: { zweiterFrei: false } },
  );
}

describe('useFehlerOhneDaten (LLH-1577)', () => {
  it('lädt noch: nicht gescheitert', () => {
    const abruf = steuerbarerAbruf();
    const { result } = zweiBeobachter(abruf);
    expect(result.current.fehler).toEqual({ gescheitert: false, fehler: null, laedt: false });
  });

  it('bleibt gescheitert, mit demselben Fehler, während ein zweiter Beobachter neu lädt', async () => {
    const abruf = steuerbarerAbruf();
    const { result, rerender } = zweiBeobachter(abruf);
    const kaputt = new Error('kaputt');

    await waitFor(() => expect(abruf.anzahl).toBe(1));
    act(() => abruf.scheitere(0, kaputt));
    await waitFor(() => expect(result.current.fehler.gescheitert).toBe(true));
    expect(result.current.fehler).toEqual({ gescheitert: true, fehler: kaputt, laedt: false });

    // Die Freigabe kommt nach der 500: der zweite Beobachter lädt die gescheiterte Abfrage neu.
    rerender({ zweiterFrei: true });
    await waitFor(() => expect(abruf.anzahl).toBe(2));
    // TanStack setzt die Abfrage dabei zurück — genau das, was das Banner verschwinden ließ.
    expect(result.current.seite.isError).toBe(false);
    expect(result.current.seite.isPending).toBe(true);
    expect(result.current.fehler).toEqual({ gescheitert: true, fehler: kaputt, laedt: true });

    act(() => abruf.liefere(1, ['S1']));
    await waitFor(() => expect(result.current.seite.data).toEqual(['S1']));
    expect(result.current.fehler).toEqual({ gescheitert: false, fehler: kaputt, laedt: false });
  });

  it('trägt den neuen Fehler, wenn auch der zweite Versuch scheitert', async () => {
    const abruf = steuerbarerAbruf();
    const { result, rerender } = zweiBeobachter(abruf);

    await waitFor(() => expect(abruf.anzahl).toBe(1));
    act(() => abruf.scheitere(0, new Error('erster')));
    await waitFor(() => expect(result.current.fehler.gescheitert).toBe(true));

    rerender({ zweiterFrei: true });
    await waitFor(() => expect(abruf.anzahl).toBe(2));
    const zweiter = new Error('zweiter');
    act(() => abruf.scheitere(1, zweiter));
    await waitFor(() => expect(result.current.fehler.fehler).toBe(zweiter));
    expect(result.current.fehler.gescheitert).toBe(true);
    expect(result.current.fehler.laedt).toBe(false);
  });
});
