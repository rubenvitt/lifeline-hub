import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import type { ReactNode } from 'react';
import { useDokumentFreigabe } from './useDokumentFreigabe';

/**
 * Freigabe-Ablauf eines gegliederten Dokuments (LLH-1689): Befehl und Lagebericht teilen
 * Speichern → Freigeben → Dialog. Der Dialog öffnet erst mit gültigem Formular, speichert vor der
 * Freigabe und bleibt bei jeder Ablehnung offen.
 */

type Werte = { titel: string };

function aufbau(
  over: {
    validateFields?: () => Promise<Werte>;
    speichereJetzt?: (w: Werte) => Promise<void>;
    gibFrei?: () => Promise<unknown>;
  } = {},
) {
  const speichereJetzt = vi.fn(over.speichereJetzt ?? (() => Promise.resolve()));
  const gibFrei = vi.fn(over.gibFrei ?? (() => Promise.resolve({})));
  const optionen = {
    form: { validateFields: over.validateFields ?? (() => Promise.resolve({ titel: 'Lage' })) },
    schutz: { speichereJetzt, speicherFehler: null, speichertGerade: false },
    gibFrei,
    erfolgText: 'Befehl freigegeben',
    onFreigegeben: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AntApp>{children}</AntApp>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useDokumentFreigabe<Werte>(optionen), { wrapper });
  return { optionen, result };
}

describe('useDokumentFreigabe (LLH-1689)', () => {
  it('öffnet den Dialog erst mit gültigem Formular', async () => {
    const { result } = aufbau({ validateFields: () => Promise.reject(new Error('Titel fehlt')) });
    await act(() => result.current.bestaetigen());
    expect(result.current.dialog.offen).toBe(false);
  });

  it('speichert vor der Freigabe die validierten Werte und schließt danach', async () => {
    const { optionen, result } = aufbau();
    await act(() => result.current.bestaetigen());
    expect(result.current.dialog.offen).toBe(true);

    await act(async () => result.current.dialog.onFreigeben());
    await waitFor(() => expect(result.current.dialog.offen).toBe(false));
    expect(optionen.schutz.speichereJetzt).toHaveBeenCalledWith({ titel: 'Lage' });
    expect(optionen.gibFrei).toHaveBeenCalledTimes(1);
    expect(optionen.schutz.speichereJetzt.mock.invocationCallOrder[0]).toBeLessThan(
      optionen.gibFrei.mock.invocationCallOrder[0],
    );
    expect(optionen.onFreigegeben).toHaveBeenCalledTimes(1);
  });

  it('bleibt offen und gibt nicht frei, wenn das Speichern scheitert', async () => {
    const { optionen, result } = aufbau({
      speichereJetzt: () => Promise.reject(new Error('409')),
    });
    await act(() => result.current.bestaetigen());
    await act(async () => result.current.dialog.onFreigeben());
    expect(result.current.dialog.offen).toBe(true);
    expect(optionen.gibFrei).not.toHaveBeenCalled();
  });

  it('bleibt offen mit dem Grund, wenn die Freigabe abgelehnt wird; ein neuer Versuch räumt ihn', async () => {
    const grund = new Error('leer');
    const { optionen, result } = aufbau({ gibFrei: () => Promise.reject(grund) });
    await act(() => result.current.bestaetigen());
    await act(async () => result.current.dialog.onFreigeben());
    await waitFor(() => expect(result.current.dialog.freigabeFehler).toBe(grund));
    expect(result.current.dialog.offen).toBe(true);
    expect(optionen.onFreigegeben).not.toHaveBeenCalled();

    await act(async () => result.current.dialog.onAbbrechen());
    expect(result.current.dialog.offen).toBe(false);
    await act(() => result.current.bestaetigen());
    expect(result.current.dialog.freigabeFehler).toBeNull();
  });

  it('speichern ruft speichereJetzt mit den Werten des Formulars', async () => {
    const { optionen, result } = aufbau();
    act(() => result.current.speichern({ titel: 'Neu' }));
    await waitFor(() =>
      expect(optionen.schutz.speichereJetzt).toHaveBeenCalledWith({ titel: 'Neu' }),
    );
  });
});
