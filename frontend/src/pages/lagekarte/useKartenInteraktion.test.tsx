import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import type { GeoJsonGeometry } from './geo';
import { useKartenInteraktion } from './useKartenInteraktion';

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
];

describe('useKartenInteraktion — Selektions-Gate während exklusiver Modi (LFH-208)', () => {
  describe('Baseline: ohne aktiven Modus selektiert der Klick normal', () => {
    it('onZoneKlick setzt zoneAuswahl', () => {
      const { result } = rendere();
      act(() => result.current.onZoneKlick(5));
      expect(result.current.zoneAuswahl).toBe(5);
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
