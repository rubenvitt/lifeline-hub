// frontend/src/etb/entwuerfe/useEtbEntwuerfe.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { entwuerfeLaden, entwuerfeLeerenFuerTests, entwurfSpeichern } from './entwurfStore';
import type { EtbEntwurf } from './entwurfModell';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  return {
    id: 'vorhanden', einsatz_id: 7, inhalt: 'Bestand', typ: 'meldung',
    erstellt_at: '2026-06-22T10:00:00.000Z', geaendert_at: '2026-06-22T10:00:00.000Z', ...over,
  };
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  localStorage.clear();
});

describe('useEtbEntwuerfe', () => {
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

    await act(async () => { await result.current.entwurfSchliessen('x'); });
    expect(await entwuerfeLaden(7)).toHaveLength(0);
    expect(result.current.entwuerfe).toHaveLength(1); // neuer leerer Tab
    expect(result.current.entwuerfe[0].inhalt).toBe('');
  });
});
