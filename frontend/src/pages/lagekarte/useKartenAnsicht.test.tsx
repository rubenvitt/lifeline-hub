import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import type { KarteServerConfig } from '../../api/karte';
import type { KartenAnsicht, PatchKartenAnsicht } from '../../api/types';

const ladeKartenAnsichten = vi.fn();
const patcheKartenAnsicht = vi.fn();
const erstelleKartenAnsicht = vi.fn();
const loescheKartenAnsicht = vi.fn();
vi.mock('../../api/kartenAnsicht', () => ({
  ladeKartenAnsichten: (...a: unknown[]) => ladeKartenAnsichten(...a),
  patcheKartenAnsicht: (...a: unknown[]) => patcheKartenAnsicht(...a),
  erstelleKartenAnsicht: (...a: unknown[]) => erstelleKartenAnsicht(...a),
  loescheKartenAnsicht: (...a: unknown[]) => loescheKartenAnsicht(...a),
}));

import { useKartenAnsicht } from './useKartenAnsicht';
import { fachebeneKeys } from './fachebenen';

// Minimal-Config: online + offline verfügbar, damit waehleInitialeBasemap beide Modi akzeptiert.
const CONFIG = {
  online_styles: [{ name: 'Standard' }],
  offline_verfuegbar: true,
} as unknown as KarteServerConfig;

function standardansicht(over: Partial<KartenAnsicht> = {}): KartenAnsicht {
  return {
    id: 1,
    einsatz_id: 5,
    name: 'Standard',
    reihenfolge: 0,
    ist_standard: true,
    basemap_modus: 'offline',
    erstellt_at: '',
    geaendert_at: '',
    ...over,
  } as KartenAnsicht;
}

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useKartenAnsicht', () => {
  beforeEach(() => {
    ladeKartenAnsichten.mockReset();
    patcheKartenAnsicht.mockReset();
    erstelleKartenAnsicht.mockReset();
    loescheKartenAnsicht.mockReset();
  });

  it('hydratisiert aus der Standardansicht und ist zunächst nicht schmutzig', async () => {
    ladeKartenAnsichten.mockResolvedValue([standardansicht({ basemap_modus: 'offline' })]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.basemap).toBe('offline'));
    expect(result.current.dirty).toBe(false);
  });

  it('hydratisiert die Autobahn-Sichtbarkeit aus der gespeicherten Ansicht (LFH-80)', async () => {
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({
        fachebenen_sichtbar: { autobahn: true, nina: true },
      } as Partial<KartenAnsicht>),
    ]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.fachebenenSichtbar.autobahn).toBe(true));
    // Die Spalte ist opakes JSON; ein neuer Key ohne Eintrag in `leseFachebenen` käme
    // stillschweigend als `undefined` zurück und die Ebene wäre nach jedem Reload aus —
    // ohne Fehler und ohne roten Test anderswo.
    expect(result.current.fachebenenSichtbar.nina).toBe(true);
    expect(result.current.fachebenenSichtbar.kritis).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('das Umschalten der Autobahn-Ebene macht die Ansicht schmutzig (LFH-80)', async () => {
    ladeKartenAnsichten.mockResolvedValue([standardansicht()]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    // Auf die HYDRATION warten, nicht auf `dirty === false`: das ist es vor dem Hydrieren
    // ohnehin, die Bedingung wäre sofort erfüllt und der Toggle liefe ins Re-Seed.
    await waitFor(() => expect(result.current.basemap).toBe('offline'));
    expect(result.current.dirty).toBe(false);
    // Ohne den Key im Vergleichs-Tupel (`FACHEBENE_KEYS`) bliebe die Ansicht sauber und
    // „Ansicht speichern" böte sich nie an — die Wahl wäre nach dem Reload weg.
    act(() => result.current.setFachebenenSichtbar((v) => ({ ...v, autobahn: true })));
    await waitFor(() => expect(result.current.dirty).toBe(true));
  });

  it('hydratisiert die Luftqualitäts-Sichtbarkeit und liest einen alten Stand als aus (LFH-79)', async () => {
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({
        fachebenen_sichtbar: { luftqualitaet: true },
      } as Partial<KartenAnsicht>),
    ]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.fachebenenSichtbar.luftqualitaet).toBe(true));
    expect(result.current.dirty).toBe(false);
  });

  it('ein vor LFH-79 gespeicherter Stand kennt den Schlüssel nicht → Ebene aus', async () => {
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({
        fachebenen_sichtbar: { nina: true },
      } as Partial<KartenAnsicht>),
    ]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.fachebenenSichtbar.nina).toBe(true));
    expect(result.current.fachebenenSichtbar.luftqualitaet).toBe(false);
  });

  it('ein gespeicherter Stand ohne Energie-Schlüssel liest „aus" (LFH-81)', async () => {
    // Ein vor LFH-81 gespeicherter Stand: andere Ebenen an, `energie` fehlt ganz.
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({
        fachebenen_sichtbar: { kritis: true, nina: true },
      } as Partial<KartenAnsicht>),
    ]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.fachebenenSichtbar.kritis).toBe(true));
    // `toBe(false)`, nicht `toBeFalsy()`: ein fehlender Eintrag in `leseFachebenen` käme als
    // `undefined` zurück und wäre für den Schalter „aus", für den Vergleich aber ein Wert.
    expect(result.current.fachebenenSichtbar.energie).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('hydratisiert eine gespeicherte Energie-Sichtbarkeit (LFH-81)', async () => {
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({ fachebenen_sichtbar: { energie: true } } as Partial<KartenAnsicht>),
    ]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.fachebenenSichtbar.energie).toBe(true));
    expect(result.current.dirty).toBe(false);
  });

  // Jede Fachebene muss den Schmutzig-Vergleich treffen — sonst böte sich „Ansicht
  // speichern" nach dem Umschalten nie an. `hochwasser` fehlte im Vergleichs-Tupel seit
  // LFH-77; der Test läuft deshalb über ALLE Ebenen (seit LFH-81 auch `energie`), nicht nur
  // über die jeweils neue.
  it.each(fachebeneKeys())('das Umschalten von %s macht die Ansicht schmutzig', async (k) => {
    ladeKartenAnsichten.mockResolvedValue([standardansicht()]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.basemap).toBe('offline'));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setFachebenenSichtbar((v) => ({ ...v, [k]: !v[k] })));
    await waitFor(() => expect(result.current.dirty).toBe(true));
  });

  it('hydratisiert die ODL-Sichtbarkeit aus der gespeicherten Ansicht (LFH-78)', async () => {
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({
        fachebenen_sichtbar: { odl: true, dwd: true },
      } as Partial<KartenAnsicht>),
    ]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.fachebenenSichtbar.odl).toBe(true));
    expect(result.current.fachebenenSichtbar.dwd).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it('liest einen vor LFH-78 gespeicherten Stand ohne `odl` als „aus"', async () => {
    // Genau der Bestand jeder heute gespeicherten Ansicht: der Schlüssel fehlt. Er muss als
    // `false` ankommen, nicht als `undefined` — die übrigen Ebenen behalten ihren Stand.
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({
        fachebenen_sichtbar: { hochwasser: true, autobahn: true },
      } as Partial<KartenAnsicht>),
    ]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.fachebenenSichtbar.hochwasser).toBe(true));
    expect(result.current.fachebenenSichtbar.odl).toBe(false);
    expect(result.current.fachebenenSichtbar.autobahn).toBe(true);
  });

  it('das Umschalten der ODL-Ebene macht die Ansicht schmutzig (LFH-78)', async () => {
    ladeKartenAnsichten.mockResolvedValue([standardansicht()]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.basemap).toBe('offline'));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setFachebenenSichtbar((v) => ({ ...v, odl: true })));
    await waitFor(() => expect(result.current.dirty).toBe(true));
  });

  it('das Umschalten der Hochwasser-Ebene macht die Ansicht schmutzig (Nachzug LFH-77)', async () => {
    // Gefunden beim Anfassen für LFH-78: das Vergleichs-Tupel führte `hochwasser` nicht,
    // die Wahl ging beim Neuladen verloren. Jede Ebene aus `fachebeneKeys()` gehört hinein.
    ladeKartenAnsichten.mockResolvedValue([standardansicht()]);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.basemap).toBe('offline'));
    act(() => result.current.setFachebenenSichtbar((v) => ({ ...v, hochwasser: true })));
    await waitFor(() => expect(result.current.dirty).toBe(true));
  });

  it('wird schmutzig bei Basemap-Wechsel und wieder sauber nach dem Speichern', async () => {
    ladeKartenAnsichten.mockResolvedValue([standardansicht({ basemap_modus: 'offline' })]);
    patcheKartenAnsicht.mockImplementation((_e: number, _a: number, patch: PatchKartenAnsicht) =>
      Promise.resolve(standardansicht({ basemap_modus: patch.basemap_modus ?? 'offline' })),
    );
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.basemap).toBe('offline'));

    act(() => result.current.setBasemap('online'));
    expect(result.current.dirty).toBe(true);

    // Nach dem Speichern holt der Refetch die gespeicherte Ansicht ein → current === ansicht → sauber.
    ladeKartenAnsichten.mockResolvedValue([standardansicht({ basemap_modus: 'online' })]);
    await act(async () => {
      await result.current.speichern();
    });
    await waitFor(() => expect(result.current.dirty).toBe(false));
    expect(result.current.basemap).toBe('online');
    expect(patcheKartenAnsicht).toHaveBeenCalledWith(
      5,
      1,
      expect.objectContaining({ basemap_modus: 'online' }),
    );
  });

  it('überschreibt bei einem Refetch (gleiche Ansicht-id) einen User-Edit NICHT (hydrate-once)', async () => {
    ladeKartenAnsichten.mockResolvedValue([standardansicht({ basemap_modus: 'offline' })]);
    const client = neuerQueryClient();
    const w = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: w,
    });
    await waitFor(() => expect(result.current.basemap).toBe('offline'));

    // User ändert lokal (ohne Speichern)
    act(() => result.current.setBasemap('blind'));
    expect(result.current.dirty).toBe(true);

    // Ein externer Refetch (gleiche Ansicht) darf den User-Edit nicht zurücksetzen.
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['einsatz-karten-ansicht', 5] });
    });
    expect(result.current.basemap).toBe('blind');
    expect(result.current.dirty).toBe(true);
  });

  // ---------- B (LFH-320) ----------

  it('wählt die Ansicht aus aktiveAnsichtId statt der Standardansicht', async () => {
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({ id: 1, basemap_modus: 'offline' }),
      standardansicht({ id: 2, ist_standard: false, name: 'Nord', basemap_modus: 'online' }),
    ]);
    const { result } = renderHook(
      () => useKartenAnsicht({ einsatzId: 5, config: CONFIG, aktiveAnsichtId: 2 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.aktiveAnsicht?.id).toBe(2));
    await waitFor(() => expect(result.current.basemap).toBe('online'));
  });

  it('re-seedet die Config bei einem Ansichtswechsel (neue view-id)', async () => {
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({ id: 1, basemap_modus: 'offline' }),
      standardansicht({ id: 2, ist_standard: false, basemap_modus: 'online' }),
    ]);
    const { result, rerender } = renderHook(
      ({ aid }: { aid: number }) =>
        useKartenAnsicht({ einsatzId: 5, config: CONFIG, aktiveAnsichtId: aid }),
      { wrapper: wrapper(), initialProps: { aid: 1 } },
    );
    await waitFor(() => expect(result.current.basemap).toBe('offline'));
    rerender({ aid: 2 });
    await waitFor(() => expect(result.current.basemap).toBe('online'));
  });

  it('„Als neue Ansicht speichern" sendet Name + aktuellen Karten-Zustand', async () => {
    ladeKartenAnsichten.mockResolvedValue([standardansicht({ basemap_modus: 'offline' })]);
    erstelleKartenAnsicht.mockResolvedValue(
      standardansicht({ id: 9, ist_standard: false, name: 'Neu' }),
    );
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.basemap).toBe('offline'));

    act(() => result.current.setBasemap('online'));
    await act(async () => {
      await result.current.neueAnsicht('Neu');
    });
    expect(erstelleKartenAnsicht).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ name: 'Neu', basemap_modus: 'online' }),
    );
  });

  it('löscht eine Ansicht mit der gewählten Objekt-Behandlung', async () => {
    ladeKartenAnsichten.mockResolvedValue([
      standardansicht({ id: 1 }),
      standardansicht({ id: 2, ist_standard: false, name: 'Nord' }),
    ]);
    loescheKartenAnsicht.mockResolvedValue(undefined);
    const { result } = renderHook(() => useKartenAnsicht({ einsatzId: 5, config: CONFIG }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ansichten?.length).toBe(2));
    await act(async () => {
      await result.current.loeschen({ id: 2, objekte: 'loeschen' });
    });
    expect(loescheKartenAnsicht).toHaveBeenCalledWith(5, 2, 'loeschen');
  });
});
