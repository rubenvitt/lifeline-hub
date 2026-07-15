import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import type { GeoJsonGeometry } from './geo';
import { useKartenInteraktion } from './useKartenInteraktion';

// API-Client der freien Zeichen mocken (LFH-170 Etappe 3): der Hook ruft ihn bei Platzieren/
// Ändern/Löschen; hier nur die Aufrufe prüfen (kein Netz).
const freieZeichenApi = vi.hoisted(() => ({
  legeFreiesZeichenAn: vi.fn(() => Promise.resolve({ id: 42 })),
  aktualisiereFreiesZeichen: vi.fn(() => Promise.resolve({ id: 42 })),
  loescheFreiesZeichen: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../api/freieZeichen', () => freieZeichenApi);

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function rendere() {
  return renderHook(
    () =>
      useKartenInteraktion({
        einsatzId: 1,
        einsatz: undefined,
        darfSchreiben: true,
        alleVerortet: [],
        fehler: vi.fn(),
      }),
    { wrapper: wrapper() },
  );
}

type HookResult = ReturnType<typeof rendere>['result'];

const POLYGON: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};

// Jeder wechselseitig-exklusive Interaktionsmodus samt seiner Start-Sequenz.
// Während eines dieser Modi darf ein Karten-Klick auf ein bestehendes Objekt kein
// Auswahl-Panel öffnen (LFH-208: sonst Doppel-Panel neben der ZeichnenSteuerung).
const MODI: { name: string; betreten: (r: HookResult) => void }[] = [
  { name: 'platzieren', betreten: (r) => act(() => r.current.onPlatzierenStart({ typ: 'uhs', id: 2 })) },
  { name: 'bild-platzieren', betreten: (r) => act(() => r.current.onBildPlatzieren(7)) },
  { name: 'abschnitt-zeichnen', betreten: (r) => act(() => r.current.onAbschnittZeichnenStart(3)) },
  {
    name: 'zone-zeichnen',
    betreten: (r) => act(() => r.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' })),
  },
  {
    name: 'zone-bestaetigung',
    betreten: (r) => {
      act(() => r.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
      act(() => r.current.onZoneGezeichnet(POLYGON));
    },
  },
  // LFH-170: das Platzieren eines freien Zeichens ist ebenfalls exklusiv → muss das
  // Selektions-Gate (exklusiverModusAktiv) auslösen.
  {
    name: 'zeichen-platzieren',
    betreten: (r) => act(() => r.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' })),
  },
];

describe('useKartenInteraktion — Selektions-Gate während exklusiver Modi (LFH-208)', () => {
  describe('Baseline: ohne aktiven Modus selektiert der Klick normal', () => {
    it('onZoneKlick setzt zoneAuswahl', () => {
      const { result } = rendere();
      act(() => result.current.onZoneKlick(5));
      expect(result.current.zoneAuswahl).toBe(5);
    });
    it('onFachebeneKlick reicht die (un-geclippte) Geometrie an fachebeneAuswahl durch (LFH-146)', () => {
      const { result } = rendere();
      const geom = { type: 'Polygon', coordinates: [[[8, 50], [8.1, 50], [8.1, 50.1], [8, 50]]] };
      act(() => result.current.onFachebeneKlick({ a: 1 }, 'nina', geom));
      expect(result.current.fachebeneAuswahl?.geometrie).toBe(geom);
    });
    it('onFlaecheKlick setzt auswahl auf abschnitt-<id>', () => {
      const { result } = rendere();
      act(() => result.current.onFlaecheKlick(3));
      expect(result.current.auswahl).toBe('abschnitt-3');
    });
    it('onFachebeneKlick setzt fachebeneAuswahl', () => {
      const { result } = rendere();
      act(() => result.current.onFachebeneKlick({ a: 1 }, 'nina'));
      expect(result.current.fachebeneAuswahl).not.toBeNull();
    });
  });

  it('exklusiverModusAktiv ist ohne aktiven Modus false', () => {
    const { result } = rendere();
    expect(result.current.exklusiverModusAktiv).toBe(false);
  });

  describe.each(MODI)('Modus „$name"', ({ betreten }) => {
    it('setzt exklusiverModusAktiv=true', () => {
      const { result } = rendere();
      betreten(result);
      expect(result.current.exklusiverModusAktiv).toBe(true);
    });
    it('onZoneKlick öffnet kein Zonen-Panel (No-op)', () => {
      const { result } = rendere();
      betreten(result);
      act(() => result.current.onZoneKlick(5));
      expect(result.current.zoneAuswahl).toBeNull();
    });
    it('onFlaecheKlick öffnet kein Abschnitt-Panel (No-op)', () => {
      const { result } = rendere();
      betreten(result);
      act(() => result.current.onFlaecheKlick(3));
      expect(result.current.auswahl).toBeNull();
    });
    it('onFachebeneKlick öffnet kein Fachebenen-Panel (No-op)', () => {
      const { result } = rendere();
      betreten(result);
      act(() => result.current.onFachebeneKlick({ a: 1 }, 'nina'));
      expect(result.current.fachebeneAuswahl).toBeNull();
    });
  });
});

describe('useKartenInteraktion — freies Zeichen platzieren (LFH-170)', () => {
  it('onZeichenPlatzierenStart setzt zeichenPlatzieren und resettet andere Modi', () => {
    const { result } = rendere();
    act(() => result.current.onPlatzierenStart({ typ: 'uhs', id: 2 }));
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    expect(result.current.zeichenPlatzieren).toEqual({ grundzeichen: 'stelle' });
    expect(result.current.platzierungZiel).toBeNull();
  });

  it('ein anderer Start-Modus resettet zeichenPlatzieren (Mutual-Exclusion, LFH-145)', () => {
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    act(() => result.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
    expect(result.current.zeichenPlatzieren).toBeNull();
  });

  it('onKarteKlick bei aktivem zeichenPlatzieren legt ein freies Zeichen an (POST mit Klick-Koordinate)', async () => {
    freieZeichenApi.legeFreiesZeichenAn.mockClear();
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle', label: 'X' }));
    act(() => result.current.onKarteKlick({ lng: 8.6, lat: 50.1 }));
    await waitFor(() =>
      expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledWith(1, {
        lat: 50.1,
        lon: 8.6,
        grundzeichen: 'stelle',
        label: 'X',
      }),
    );
    // nach erfolgreichem Anlegen ist der Platzier-Modus beendet
    await waitFor(() => expect(result.current.zeichenPlatzieren).toBeNull());
  });

  it('Doppelklick legt nur EIN freies Zeichen an (isPending-Guard, kein Duplikat)', async () => {
    // Mutation pending halten → der zweite Klick trifft den Guard, bevor onSuccess
    // zeichenPlatzieren leert. legeFreiesZeichenAn erzeugt je Aufruf eine NEUE Entität
    // (nicht idempotent), ein zweiter Aufruf würde ein Duplikat anlegen.
    let aufloesen: (v: unknown) => void = () => {};
    freieZeichenApi.legeFreiesZeichenAn.mockReset();
    freieZeichenApi.legeFreiesZeichenAn.mockImplementation(
      () => new Promise((r) => { aufloesen = r; }),
    );
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    act(() => result.current.onKarteKlick({ lng: 8.6, lat: 50.1 }));
    await waitFor(() => expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledTimes(1));
    // zweiter Klick, während die erste Mutation noch pending ist → Guard greift
    act(() => result.current.onKarteKlick({ lng: 8.7, lat: 50.2 }));
    await new Promise((r) => setTimeout(r, 15));
    expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledTimes(1);
    aufloesen({ id: 1 });
    freieZeichenApi.legeFreiesZeichenAn.mockReset();
    freieZeichenApi.legeFreiesZeichenAn.mockImplementation(() => Promise.resolve({ id: 42 }));
  });
});
