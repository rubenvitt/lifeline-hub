import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import type { LageZone } from '../../api/types';
import { kreisPolygon, type GeoJsonPolygon } from './geo';
import { useKartenInteraktion } from './useKartenInteraktion';

// Zonen-API mocken: geprüft wird, was hinausgeht. Jeder vom Hook importierte Export muss dabei sein.
const lagezonenApi = vi.hoisted(() => ({
  legeZoneAn: vi.fn(() => Promise.resolve({ id: 5 })),
  aktualisiereZone: vi.fn<(eid: number, zid: number, patch: object) => Promise<{ id: number }>>(
    () => Promise.resolve({ id: 5 }),
  ),
  loescheZone: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../api/lagezonen', () => lagezonenApi);

const FLAECHE: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [9, 54],
      [9.01, 54],
      [9.01, 54.01],
      [9, 54.01],
      [9, 54],
    ],
  ],
};

function zone(teil: Partial<LageZone> = {}): LageZone {
  return {
    id: 7,
    einsatz_id: 1,
    typ: 'absperrbereich',
    geometrie_typ: 'Polygon',
    geometrie: JSON.stringify(FLAECHE),
    label: 'Nord',
    farbe: null,
    notiz: null,
    gefahrengebiet_id: null,
    ansicht_id: null,
    erstellt_von: 1,
    erstellt_at: '2026-10-21T10:00:00Z',
    geaendert_at: '2026-10-21T10:00:00Z',
    ...teil,
  } as LageZone;
}

const KREISZONE = zone({
  geometrie: JSON.stringify(kreisPolygon({ lat: 54, lon: 9.5 }, 300)),
  kreis_mitte_lat: 54,
  kreis_mitte_lon: 9.5,
  kreis_radius_m: 300,
});

function rendere(opts: { fehler?: (e: unknown) => void; erfolg?: (t: string) => void } = {}) {
  const client = neuerQueryClient();
  const warnung = vi.fn();
  const verwirfHandlung = vi.fn();
  const hook = renderHook(
    () =>
      useKartenInteraktion({
        einsatzId: 1,
        darfSchreiben: true,
        waehlbarRef: { current: [] },
        beginneHandlung: () => opts.fehler ?? vi.fn(),
        verwirfHandlung,
        erfolg: opts.erfolg ?? vi.fn(),
        warnung,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  return { ...hook, warnung, verwirfHandlung };
}

beforeEach(() => {
  lagezonenApi.aktualisiereZone.mockReset();
  lagezonenApi.aktualisiereZone.mockImplementation(() => Promise.resolve({ id: 7 }));
});

describe('useKartenInteraktion — Punkte bearbeiten (LLH-1344)', () => {
  it('startet exklusiv, schließt die Auswahl und blendet die Zone aus', () => {
    const { result } = rendere();
    act(() => result.current.onZoneKlick(7));
    expect(result.current.zoneAuswahl).toBe(7);
    act(() => result.current.onPunkteBearbeiten(zone()));
    expect(result.current.zonenBearbeitung?.zoneId).toBe(7);
    expect(result.current.zonenBearbeitung?.kreis).toBe(false);
    expect(result.current.exklusiverModusAktiv).toBe(true);
    expect(result.current.zoneAuswahl).toBeNull();
    expect(result.current.bearbeiteteZoneId).toBe(7);
  });

  it('„Übernehmen“ schickt GENAU EINEN PATCH mit der neuen Geometrie und wählt die Zone wieder', async () => {
    const erfolg = vi.fn();
    const { result } = rendere({ erfolg });
    act(() => result.current.onPunkteBearbeiten(KREISZONE));
    expect(result.current.zonenBearbeitung?.kreis).toBe(true);
    act(() =>
      result.current.onBearbeitung({
        art: 'verschieben',
        punkt: { ring: 0, index: 0 },
        lage: [9.5, 54.004],
      }),
    );
    act(() => result.current.bearbeitungUebernehmen());
    // Ein zweiter Druck während des Speicherns schickt nichts.
    act(() => result.current.bearbeitungUebernehmen());
    await waitFor(() => expect(result.current.zonenBearbeitung).toBeNull());
    expect(lagezonenApi.aktualisiereZone).toHaveBeenCalledTimes(1);
    const [eid, zid, patch] = lagezonenApi.aktualisiereZone.mock.calls[0] as [
      number,
      number,
      Record<string, unknown>,
    ];
    expect([eid, zid]).toEqual([1, 7]);
    // Nur die Geometrie: die Kreisangaben nimmt der Server weg (LLH-1043, D3).
    expect(Object.keys(patch)).toEqual(['geometrie']);
    const g = JSON.parse(patch.geometrie as string) as GeoJsonPolygon;
    expect(g.coordinates[0][0]).toEqual([9.5, 54.004]);
    expect(g.coordinates[0][g.coordinates[0].length - 1]).toEqual([9.5, 54.004]);
    expect(erfolg).toHaveBeenCalledWith('Zone gespeichert');
    expect(result.current.zoneAuswahl).toBe(7);
  });

  it('ohne Änderung schickt „Übernehmen“ nichts', () => {
    const { result } = rendere();
    act(() => result.current.onPunkteBearbeiten(zone()));
    act(() => result.current.bearbeitungUebernehmen());
    expect(lagezonenApi.aktualisiereZone).not.toHaveBeenCalled();
    expect(result.current.zonenBearbeitung).not.toBeNull();
  });

  it('eine Ablehnung lässt Modus und Änderung stehen', async () => {
    lagezonenApi.aktualisiereZone.mockImplementation(() => Promise.reject(new Error('nein')));
    const fehler = vi.fn();
    const { result } = rendere({ fehler });
    act(() => result.current.onPunkteBearbeiten(zone()));
    act(() =>
      result.current.onBearbeitung({ art: 'einfuegen', ring: 0, nach: 0, lage: [9.005, 53.999] }),
    );
    act(() => result.current.bearbeitungUebernehmen());
    await waitFor(() => expect(fehler).toHaveBeenCalled());
    await waitFor(() => expect(result.current.zonenBearbeitung?.speichern).toBe(false));
    expect(result.current.zonenBearbeitung?.stand.geometrie.coordinates[0]).toHaveLength(6);
  });

  it('Abbrechen beendet ohne PATCH und wählt die Zone wieder', () => {
    const { result, verwirfHandlung } = rendere();
    act(() => result.current.onPunkteBearbeiten(zone()));
    act(() => result.current.onBearbeitung({ art: 'waehlen', punkt: { ring: 0, index: 1 } }));
    act(() => result.current.onBearbeitung({ art: 'entfernen' }));
    act(() => result.current.onBearbeitenAbbrechen());
    expect(result.current.zonenBearbeitung).toBeNull();
    expect(result.current.zoneAuswahl).toBe(7);
    expect(lagezonenApi.aktualisiereZone).not.toHaveBeenCalled();
    expect(verwirfHandlung).toHaveBeenCalledWith('zone:7');
  });

  it('ein Tipp auf die Karte hebt nur die Wahl auf', () => {
    const { result } = rendere();
    act(() => result.current.onPunkteBearbeiten(zone()));
    act(() => result.current.onBearbeitung({ art: 'waehlen', punkt: { ring: 0, index: 2 } }));
    act(() => result.current.onKarteKlick({ lng: 9, lat: 54 }));
    expect(result.current.zonenBearbeitung?.stand.gewaehlt).toBeNull();
    expect(result.current.zonenBearbeitung).not.toBeNull();
  });

  it('über der Stützpunkt-Grenze des Servers: Warnung, kein PATCH', () => {
    const { result, warnung } = rendere();
    const ring = Array.from({ length: 5_000 }, (_, i) => [9 + i * 1e-6, 54 + (i % 2) * 1e-6]);
    const gross: GeoJsonPolygon = { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
    act(() => result.current.onPunkteBearbeiten(zone({ geometrie: JSON.stringify(gross) })));
    act(() =>
      result.current.onBearbeitung({ art: 'einfuegen', ring: 0, nach: 0, lage: [9, 54.0001] }),
    );
    act(() => result.current.bearbeitungUebernehmen());
    expect(warnung).toHaveBeenCalled();
    expect(lagezonenApi.aktualisiereZone).not.toHaveBeenCalled();
  });
});

describe('useKartenInteraktion — Mitte verschieben (LLH-1344)', () => {
  it('startet den Kreis-Modus mit dem gespeicherten Kreis', () => {
    const { result } = rendere();
    act(() => result.current.onMitteVerschieben(KREISZONE));
    expect(result.current.kreisEntwurf).toEqual({ mitte: { lat: 54, lon: 9.5 }, radiusM: 300 });
    expect(result.current.kreisBearbeitung?.zoneId).toBe(7);
    expect(result.current.kreisBearbeitungGeaendert).toBe(false);
    expect(result.current.bearbeiteteZoneId).toBe(7);
    // Eine Zone ohne Kreis hat keine Mitte.
    const zwei = rendere();
    act(() => zwei.result.current.onMitteVerschieben(zone()));
    expect(zwei.result.current.kreisEntwurf).toBeNull();
  });

  it('neue Mitte → ein PATCH mit der Mitte, der Radius bleibt draußen', async () => {
    const { result } = rendere();
    act(() => result.current.onMitteVerschieben(KREISZONE));
    act(() => result.current.onKarteKlick({ lng: 9.51, lat: 54.002 }));
    expect(result.current.kreisBearbeitungGeaendert).toBe(true);
    act(() => result.current.kreisUebernehmen());
    await waitFor(() => expect(result.current.kreisEntwurf).toBeNull());
    expect(lagezonenApi.aktualisiereZone).toHaveBeenCalledTimes(1);
    expect(lagezonenApi.aktualisiereZone.mock.calls[0][2]).toEqual({
      kreis_mitte_lat: 54.002,
      kreis_mitte_lon: 9.51,
    });
    expect(result.current.zoneAuswahl).toBe(7);
  });

  it('nur der Radius → nur `kreis_radius_m`; unverändert → kein PATCH', async () => {
    const { result } = rendere();
    act(() => result.current.onMitteVerschieben(KREISZONE));
    act(() => result.current.kreisUebernehmen());
    expect(lagezonenApi.aktualisiereZone).not.toHaveBeenCalled();
    act(() => result.current.onKreisRadius(500));
    act(() => result.current.kreisUebernehmen());
    await waitFor(() => expect(lagezonenApi.aktualisiereZone).toHaveBeenCalledTimes(1));
    expect(lagezonenApi.aktualisiereZone.mock.calls[0][2]).toEqual({ kreis_radius_m: 500 });
  });

  it('erstes Esc (verwerfen) setzt auf den gespeicherten Kreis zurück, die Art bleibt fest', () => {
    const { result } = rendere();
    act(() => result.current.onMitteVerschieben(KREISZONE));
    act(() => result.current.onKreisMitte({ lat: 54.1, lon: 9.6 }));
    act(() => result.current.onKreisRadius(1000));
    act(() => result.current.onKreisTyp('sperrgebiet'));
    expect(result.current.zoneEntwurf?.typ).toBe('absperrbereich');
    act(() => result.current.onKreisVerwerfen());
    expect(result.current.kreisEntwurf).toEqual({ mitte: { lat: 54, lon: 9.5 }, radiusM: 300 });
    expect(result.current.kreisBearbeitungGeaendert).toBe(false);
  });

  it('Abbrechen wählt die Zone wieder', () => {
    const { result, verwirfHandlung } = rendere();
    act(() => result.current.onMitteVerschieben(KREISZONE));
    act(() => result.current.onZeichnenAbbrechen());
    expect(result.current.kreisEntwurf).toBeNull();
    expect(result.current.zoneAuswahl).toBe(7);
    expect(verwirfHandlung).toHaveBeenCalledWith('zone:7');
  });
});
