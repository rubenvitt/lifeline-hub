// frontend/src/etb/entwuerfe/useEtbEntwuerfe.test.tsx
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as entwurfStore from './entwurfStore';
import { entwuerfeLaden, entwuerfeLeerenFuerTests, entwurfSpeichern } from './entwurfStore';
import type { EtbEntwurf } from './entwurfModell';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  return {
    id: 'vorhanden',
    einsatz_id: 7,
    inhalt: 'Bestand',
    typ: 'meldung',
    erstellt_at: '2026-06-22T10:00:00.000Z',
    geaendert_at: '2026-06-22T10:00:00.000Z',
    ...over,
  };
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useEtbEntwuerfe', () => {
  it('LFH-461 Review: Kontextwechsel während IndexedDB lädt verwendet die aktuelle Stelle', async () => {
    let freigeben!: (werte: EtbEntwurf[]) => void;
    const laden = vi.spyOn(entwurfStore, 'entwuerfeLaden').mockReturnValueOnce(
      new Promise<EtbEntwurf[]>((resolve) => {
        freigeben = resolve;
      }),
    );
    const { result, rerender } = renderHook(({ stelle }) => useEtbEntwuerfe(7, stelle), {
      initialProps: { stelle: 'Alter Cache' },
    });
    await waitFor(() => expect(laden).toHaveBeenCalledTimes(1));
    rerender({ stelle: 'Neue Leitung' });
    await waitFor(() => expect(result.current.entwuerfe[0]?.an).toBe('Neue Leitung'));
    await act(async () => {
      freigeben([]);
    });
    expect(result.current.entwuerfe).toHaveLength(1);
    expect(result.current.entwuerfe[0].an).toBe('Neue Leitung');
  });

  it('LFH-461: nur der erste neue Entwurf bekommt die Stelle; Rerender und Folgeentwürfe nicht', async () => {
    const { result, rerender } = renderHook(({ stelle }) => useEtbEntwuerfe(7, stelle), {
      initialProps: { stelle: 'Florian Leitung' },
    });
    await waitFor(() => expect(result.current.entwuerfe[0]?.an).toBe('Florian Leitung'));
    const id = result.current.aktiverId!;
    act(() =>
      result.current.entwurfAktualisieren(id, { inhalt: 'Text', typ: 'meldung', metadaten: {} }),
    );
    rerender({ stelle: 'Andere Leitung' });
    expect(result.current.entwuerfe[0].an).toBeUndefined();
    await act(async () => {
      await result.current.entwurfSchliessen(id);
    });
    expect(result.current.entwuerfe[0].an).toBeUndefined();
  });

  it.each(['Eigener Empfänger', undefined])(
    'LFH-461: geladener Entwurf bleibt maßgeblich (%s)',
    async (an) => {
      await entwurfSpeichern(entwurf({ an }));
      const { result } = renderHook(() => useEtbEntwuerfe(7, 'Florian Leitung'));
      await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
      expect(result.current.entwuerfe[0].an).toBe(an);
    },
  );

  it('garantiert nach dem Laden mindestens einen (leeren) Entwurf', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    expect(result.current.entwuerfe[0].inhalt).toBe('');
    expect(result.current.aktiverId).toBe(result.current.entwuerfe[0].id);
  });

  it('lädt vorhandene Entwürfe statt einen neuen anzulegen', async () => {
    await entwurfSpeichern(entwurf());
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    expect(result.current.entwuerfe[0].inhalt).toBe('Bestand');
  });

  it('persistiert einen Entwurf erst bei nicht-leerer Aktualisierung', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    const id = result.current.entwuerfe[0].id;

    // leerer Default-Tab ist NICHT in idb
    expect(await entwuerfeLaden(7)).toHaveLength(0);

    await act(async () => {
      result.current.entwurfAktualisieren(id, { inhalt: 'Pumpe', typ: 'meldung', metadaten: {} });
    });
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(1));
    expect((await entwuerfeLaden(7))[0].inhalt).toBe('Pumpe');
  });

  it('neuerEntwurf öffnet einen weiteren Tab und aktiviert ihn', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    act(() => result.current.neuerEntwurf());
    expect(result.current.entwuerfe).toHaveLength(2);
    expect(result.current.aktiverId).toBe(result.current.entwuerfe[1].id);
  });

  it('entwurfSchliessen entfernt aus idb; beim letzten entsteht ein neuer leerer', async () => {
    await entwurfSpeichern(entwurf({ id: 'x', inhalt: 'A' }));
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));

    await act(async () => {
      await result.current.entwurfSchliessen('x');
    });
    expect(await entwuerfeLaden(7)).toHaveLength(0);
    expect(result.current.entwuerfe).toHaveLength(1); // neuer leerer Tab
    expect(result.current.entwuerfe[0].inhalt).toBe('');
  });

  it('persistiert unter StrictMode nur einmal — keine idb-Writes im setEntwuerfe-Updater (LFH-216)', async () => {
    const speichernSpy = vi.spyOn(entwurfStore, 'entwurfSpeichern');
    const { result } = renderHook(() => useEtbEntwuerfe(7), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    const id = result.current.entwuerfe[0].id;
    speichernSpy.mockClear();

    await act(async () => {
      result.current.entwurfAktualisieren(id, { inhalt: 'Pumpe', typ: 'meldung', metadaten: {} });
    });
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(1));

    // Der setEntwuerfe-Updater wird unter StrictMode doppelt invoked; liegt der idb-Write
    // im Updater, läuft er doppelt. Aus dem Updater gezogen → genau ein Write.
    expect(speichernSpy).toHaveBeenCalledTimes(1);
  });

  it('schnelles Doppel-Schließen lässt keinen Zombie-Tab zurück (LFH-214-Review)', async () => {
    // Zwei entwurfSchliessen ohne das erste await abzuwarten: funktionale setEntwuerfe-Updater
    // müssen chainen (prev = frisch committeter State), damit der zweite Close auf dem Ergebnis
    // des ersten aufsetzt. Ein Closure-Snapshot / Plain-Value-Setter ließe stattdessen den
    // zuletzt geschlossenen Tab als In-Memory-Zombie zurück.
    await entwurfSpeichern(entwurf({ id: 'A', inhalt: 'A' }));
    await entwurfSpeichern(entwurf({ id: 'B', inhalt: 'B' }));
    await entwurfSpeichern(entwurf({ id: 'C', inhalt: 'C' }));
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(3));

    await act(async () => {
      const p1 = result.current.entwurfSchliessen('B');
      const p2 = result.current.entwurfSchliessen('C');
      await Promise.all([p1, p2]);
    });
    expect(result.current.entwuerfe.map((e) => e.id)).toEqual(['A']);
  });
});
