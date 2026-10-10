// frontend/src/etb/entwuerfe/useEtbEntwuerfe.test.tsx
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as entwurfStore from './entwurfStore';
import { entwuerfeLaden, entwuerfeLeerenFuerTests, entwurfSpeichern } from './entwurfStore';
import type { EtbEntwurf } from './entwurfModell';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';

/** Angemeldete Person (LFH-767): Der Hook lädt und schreibt nur ihre Entwürfe. */
const ICH = 11;

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  return {
    id: 'vorhanden',
    benutzer_id: ICH,
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
  it('LFH-894: ein neuer Entwurf trägt kein Von/An, der Standard kommt erst beim Anzeigen', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    expect(result.current.entwuerfe[0].von).toBeUndefined();
    expect(result.current.entwuerfe[0].an).toBeUndefined();
  });

  it.each(['Eigener Empfänger', undefined])(
    'geladener Entwurf bleibt maßgeblich (%s)',
    async (an) => {
      await entwurfSpeichern(entwurf({ an }));
      const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
      await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
      expect(result.current.entwuerfe[0].an).toBe(an);
    },
  );

  it('garantiert nach dem Laden mindestens einen (leeren) Entwurf', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    expect(result.current.entwuerfe[0].inhalt).toBe('');
    expect(result.current.aktiverId).toBe(result.current.entwuerfe[0].id);
  });

  it('lädt vorhandene Entwürfe statt einen neuen anzulegen', async () => {
    await entwurfSpeichern(entwurf());
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    expect(result.current.entwuerfe[0].inhalt).toBe('Bestand');
  });

  it('persistiert einen Entwurf erst bei nicht-leerer Aktualisierung', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    const id = result.current.entwuerfe[0].id;

    // leerer Default-Tab ist NICHT in idb
    expect(await entwuerfeLaden(ICH, 7)).toHaveLength(0);

    await act(async () => {
      result.current.entwurfAktualisieren(id, { inhalt: 'Pumpe', typ: 'meldung', metadaten: {} });
    });
    await waitFor(async () => expect(await entwuerfeLaden(ICH, 7)).toHaveLength(1));
    expect((await entwuerfeLaden(ICH, 7))[0].inhalt).toBe('Pumpe');
  });

  it('LFH-748: ein geleerter Entwurf mit `festhalten` bleibt gespeichert, ohne fällt er weg', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    const id = result.current.entwuerfe[0].id;
    const leer = { inhalt: '', typ: 'meldung' as const, metadaten: {} };

    await act(async () => {
      result.current.entwurfAktualisieren(id, { ...leer, inhalt: 'Pumpe' });
    });
    await waitFor(async () => expect(await entwuerfeLaden(ICH, 7)).toHaveLength(1));

    // Trägt der Entwurf Dateien, reicht der Aufrufer `festhalten`: der geleerte Stand wird
    // gespeichert — nicht entfernt und nicht mit dem alten Text.
    await act(async () => {
      result.current.entwurfAktualisieren(id, leer, { festhalten: true });
    });
    await waitFor(async () => expect((await entwuerfeLaden(ICH, 7))[0]?.inhalt).toBe(''));
    expect(await entwuerfeLaden(ICH, 7)).toHaveLength(1);

    await act(async () => {
      result.current.entwurfAktualisieren(id, leer);
    });
    await waitFor(async () => expect(await entwuerfeLaden(ICH, 7)).toHaveLength(0));
  });

  it('neuerEntwurf öffnet einen weiteren Tab und aktiviert ihn', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    act(() => result.current.neuerEntwurf());
    expect(result.current.entwuerfe).toHaveLength(2);
    expect(result.current.aktiverId).toBe(result.current.entwuerfe[1].id);
  });

  it('entwurfSchliessen entfernt aus idb; beim letzten entsteht ein neuer leerer', async () => {
    await entwurfSpeichern(entwurf({ id: 'x', inhalt: 'A' }));
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));

    await act(async () => {
      await result.current.entwurfSchliessen('x');
    });
    expect(await entwuerfeLaden(ICH, 7)).toHaveLength(0);
    expect(result.current.entwuerfe).toHaveLength(1); // neuer leerer Tab
    expect(result.current.entwuerfe[0].inhalt).toBe('');
  });

  it('LFH-1139: scheitert das Entfernen, schließt der Reiter trotzdem und hält den Grund', async () => {
    await entwurfSpeichern(entwurf({ id: 'A', inhalt: 'A' }));
    await entwurfSpeichern(entwurf({ id: 'B', inhalt: 'B' }));
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(2));
    const grund = new Error('Speicher gesperrt');
    vi.spyOn(entwurfStore, 'entwurfEntfernen').mockRejectedValueOnce(grund);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Verwirft ohne Ablehnung: der Aufrufer ruft mit `void`, ein Wurf bliebe unbehandelt.
    await act(async () => {
      await expect(result.current.entwurfSchliessen('B')).resolves.toBeUndefined();
    });
    expect(result.current.entwuerfe.map((e) => e.id)).toEqual(['A']);
    expect(result.current.schliessFehler).toBe(grund);
    // Der Plattenfehler bleibt für die Fehlersuche im Protokoll.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ETB-Entwürfe'), grund);

    // Das nächste Schließen räumt den Grund.
    await act(async () => {
      await result.current.entwurfSchliessen('A');
    });
    expect(result.current.schliessFehler).toBeNull();
  });

  it('LFH-1139: bricht die Plattentransaktion ab, holt das nächste Laden das Entfernen nach', async () => {
    // Ohne Attrappe des Speichers: der Reiter darf nur schließen, weil `entwurfEntfernen` den
    // Auftrag vor dem ersten `await` im Vorlauf vermerkt (LFH-521).
    await entwurfSpeichern(entwurf({ id: 'A', inhalt: 'A' }));
    await entwurfSpeichern(entwurf({ id: 'B', inhalt: 'B' }));
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(2));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loeschen = IDBObjectStore.prototype.delete;
    const spion = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const anfrage = loeschen.apply(this, args);
      this.transaction.abort();
      return anfrage;
    });

    await act(async () => {
      await result.current.entwurfSchliessen('B');
    });
    expect(result.current.schliessFehler).not.toBeNull();
    expect(result.current.entwuerfe.map((e) => e.id)).toEqual(['A']);
    spion.mockRestore();

    expect((await entwuerfeLaden(ICH, 7)).map((e) => e.id)).toEqual(['A']);
  });

  it('LFH-1139: der Grund lässt sich verwerfen', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    vi.spyOn(entwurfStore, 'entwurfEntfernen').mockRejectedValueOnce(new Error('voll'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      await result.current.entwurfSchliessen(result.current.entwuerfe[0].id);
    });
    expect(result.current.schliessFehler).not.toBeNull();
    act(() => result.current.schliessFehlerVerwerfen());
    expect(result.current.schliessFehler).toBeNull();
  });

  it('persistiert unter StrictMode nur einmal — keine idb-Writes im setEntwuerfe-Updater (LFH-216)', async () => {
    const speichernSpy = vi.spyOn(entwurfStore, 'entwurfSpeichern');
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    const id = result.current.entwuerfe[0].id;
    speichernSpy.mockClear();

    await act(async () => {
      result.current.entwurfAktualisieren(id, { inhalt: 'Pumpe', typ: 'meldung', metadaten: {} });
    });
    await waitFor(async () => expect(await entwuerfeLaden(ICH, 7)).toHaveLength(1));

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
    const { result } = renderHook(() => useEtbEntwuerfe(ICH, 7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(3));

    await act(async () => {
      const p1 = result.current.entwurfSchliessen('B');
      const p2 = result.current.entwurfSchliessen('C');
      await Promise.all([p1, p2]);
    });
    expect(result.current.entwuerfe.map((e) => e.id)).toEqual(['A']);
  });
});
