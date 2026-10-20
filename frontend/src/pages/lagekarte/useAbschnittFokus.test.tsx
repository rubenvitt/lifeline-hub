import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { useAbschnittFokus, type AbschnittFokusArgs } from './useAbschnittFokus';
import type { FokusQuelle } from './abschnittFokus';
import type { KartenHandle } from './Kartenflaeche';
import type { KameraStand } from './fokusKamera';
import type { KarteMarker } from './marker';

const VORHER: KameraStand = { center: [9.5, 52.3], zoom: 11, bearing: 0 };

const QUELLE: FokusQuelle = {
  abschnitte: [
    { id: 1, name: 'EA 1 Unterstadt', ueber_abschnitt_id: null },
    { id: 2, name: 'EA 2 Oberstadt', ueber_abschnitt_id: null },
    { id: 3, name: 'EA 3 ohne alles', ueber_abschnitt_id: null },
  ],
  einheiten: [{ id: 200, ueber_einheit_id: null, abschnitt_id: 2, abschnitt_name: 'EA 2' }],
  fahrzeuge: [],
};

const FLAECHEN = [
  {
    id: 1,
    polygon: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [9, 52],
          [9.1, 52],
          [9.1, 52.1],
          [9, 52],
        ],
      ],
    },
  },
];

const MARKER: KarteMarker[] = [
  {
    schluessel: 'einheit-200',
    typ: 'einheit',
    id: 200,
    lat: 53,
    lon: 10,
    label: 'E',
    farbe: '#555',
  },
];

function aufbau(teil: Partial<AbschnittFokusArgs> = {}) {
  const handle = {
    fokussiere: vi.fn(() => VORHER),
    stelleKameraHer: vi.fn(),
  };
  const kartenRef = { current: handle as unknown as KartenHandle };
  const onAuswahlAufheben = vi.fn();
  const args: AbschnittFokusArgs = {
    einsatzId: 7,
    quelle: QUELLE,
    flaechen: FLAECHEN,
    marker: MARKER,
    kartenRef,
    auswahlOffen: false,
    onAuswahlAufheben,
    modusAktiv: false,
    ...teil,
  };
  const hook = renderHook((p: AbschnittFokusArgs) => useAbschnittFokus(p), { initialProps: args });
  return { ...hook, handle, onAuswahlAufheben, args };
}

const esc = (init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(window, { key: 'Escape', ...init });
  });

describe('useAbschnittFokus (LLH-1057)', () => {
  it('ohne Fokus keine Sicht', () => {
    const { result } = aufbau();
    expect(result.current.sicht).toBeNull();
  });

  it('fokussieren: Sicht steht, die Karte passt auf die Fläche ein', () => {
    const { result, handle } = aufbau();
    act(() => result.current.fokussiere(1));
    expect(result.current.sicht?.name).toBe('EA 1 Unterstadt');
    expect(handle.fokussiere).toHaveBeenCalledWith([
      [9, 52],
      [9.1, 52.1],
    ]);
  });

  it('ohne Fläche und eigene Kräfte: Fokus ja, Anflug nein', () => {
    const { result, handle } = aufbau();
    act(() => result.current.fokussiere(3));
    expect(result.current.sicht?.name).toBe('EA 3 ohne alles');
    expect(handle.fokussiere).not.toHaveBeenCalled();
  });

  it('ein unbekannter Abschnitt setzt keinen Fokus', () => {
    const { result } = aufbau();
    act(() => result.current.fokussiere(99));
    expect(result.current.sicht).toBeNull();
  });

  it('aufheben: Sicht weg, Kamera zurück auf den Stand vor dem ersten Fokus', () => {
    const { result, handle } = aufbau();
    act(() => result.current.fokussiere(1));
    handle.fokussiere.mockReturnValue({ center: [1, 1], zoom: 15, bearing: 0 });
    act(() => result.current.fokussiere(2));
    act(() => result.current.aufheben());
    expect(result.current.sicht).toBeNull();
    expect(handle.stelleKameraHer).toHaveBeenCalledWith(VORHER);
  });

  it('gilt nur im Einsatz, in dem er gesetzt wurde', () => {
    const { result, rerender, args } = aufbau();
    act(() => result.current.fokussiere(1));
    rerender({ ...args, einsatzId: 8 });
    expect(result.current.sicht).toBeNull();
  });

  it('Esc: erst die Auswahl, dann der Fokus', () => {
    const { result, rerender, args, onAuswahlAufheben, handle } = aufbau({ auswahlOffen: true });
    act(() => result.current.fokussiere(1));
    expect(result.current.escHebtAuf).toBe(false);
    esc();
    expect(onAuswahlAufheben).toHaveBeenCalledTimes(1);
    expect(result.current.sicht).not.toBeNull();
    rerender({ ...args, auswahlOffen: false });
    expect(result.current.escHebtAuf).toBe(true);
    esc();
    expect(result.current.sicht).toBeNull();
    expect(handle.stelleKameraHer).toHaveBeenCalledWith(VORHER);
  });

  it('Esc lässt den Fokus im Kartenmodus, im Feld, bei gehaltener Taste und ohne Fokus in Ruhe', () => {
    const { result, rerender, args, onAuswahlAufheben } = aufbau({ auswahlOffen: true });
    esc();
    // Ohne Fokus gehört Esc nicht diesem Hook (das allgemeine Auswahl-Esc baut LLH-1033).
    expect(onAuswahlAufheben).not.toHaveBeenCalled();
    rerender({ ...args, auswahlOffen: false, modusAktiv: true });
    act(() => result.current.fokussiere(1));
    esc();
    expect(result.current.sicht).not.toBeNull();
    rerender({ ...args, auswahlOffen: false, modusAktiv: false });
    esc({ repeat: true });
    expect(result.current.sicht).not.toBeNull();
    const feld = document.createElement('input');
    document.body.appendChild(feld);
    act(() => {
      fireEvent.keyDown(feld, { key: 'Escape' });
    });
    expect(result.current.sicht).not.toBeNull();
    feld.remove();
  });
});
