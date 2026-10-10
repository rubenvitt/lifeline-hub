import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useKartenFehler } from './useKartenFehler';

/**
 * Gründe abgelehnter Kartenhandlungen (LFH-1077): je Schlüssel, die zuletzt begonnene Handlung
 * zählt, ein Einsatzwechsel räumt und lässt späte Antworten des alten Einsatzes nicht melden.
 */
describe('useKartenFehler', () => {
  it('meldet je Schlüssel, und ein neuer Beginn räumt nur den eigenen Grund', () => {
    const { result } = renderHook(() => useKartenFehler(1));
    let a: (e: unknown) => void = () => {};
    let b: (e: unknown) => void = () => {};
    act(() => {
      a = result.current.beginne('zone:1', 'Zone nicht gespeichert');
      b = result.current.beginne('zone:2', 'Zone nicht aufgehoben', 'Löschen fehlgeschlagen');
    });
    // Beide scheitern nebenläufig: beide Gründe stehen.
    act(() => {
      a(new Error('x'));
      b(new Error('y'));
    });
    expect(result.current.gruende.map((g) => [g.schluessel, g.titel, g.fallback])).toEqual([
      ['zone:1', 'Zone nicht gespeichert', undefined],
      ['zone:2', 'Zone nicht aufgehoben', 'Löschen fehlgeschlagen'],
    ]);
    // Ein neuer Versuch an Zone 1 räumt deren Grund, Zone 2 bleibt.
    act(() => {
      result.current.beginne('zone:1', 'Zone nicht gespeichert');
    });
    expect(result.current.gruende.map((g) => g.schluessel)).toEqual(['zone:2']);
  });

  it('eine ältere Handlung desselben Schlüssels meldet nicht mehr', () => {
    const { result } = renderHook(() => useKartenFehler(1));
    let alt: (e: unknown) => void = () => {};
    act(() => {
      alt = result.current.beginne('zeichen:4', 'Zeichen nicht gespeichert');
      result.current.beginne('zeichen:4', 'Zeichen nicht verschoben');
    });
    act(() => alt(new Error('spät')));
    expect(result.current.gruende).toEqual([]);
  });

  it('ein Einsatzwechsel räumt, und eine Antwort des alten Einsatzes meldet nicht', () => {
    const { result, rerender } = renderHook(({ id }) => useKartenFehler(id), {
      initialProps: { id: 1 },
    });
    let gescheitert: (e: unknown) => void = () => {};
    let spaet: (e: unknown) => void = () => {};
    act(() => {
      gescheitert = result.current.beginne('verorten', 'Nicht verortet');
      spaet = result.current.beginne('zone-anlegen', 'Zone nicht angelegt');
    });
    act(() => gescheitert(new Error('x')));
    expect(result.current.gruende).toHaveLength(1);
    rerender({ id: 2 });
    expect(result.current.gruende).toEqual([]);
    // Ein Grund im neuen Einsatz übersteht die späte Antwort aus dem alten.
    act(() => result.current.beginne('verorten', 'Nicht verortet')(new Error('neu')));
    act(() => spaet(new Error('alt')));
    expect(result.current.gruende.map((g) => (g.fehler as Error).message)).toEqual(['neu']);
    // Zurück zum ersten Einsatz: der alte Grund kommt nicht wieder.
    rerender({ id: 1 });
    expect(result.current.gruende).toEqual([]);
  });

  it('verwirf räumt nur den genannten Grund; ein späterer Fehler desselben Schlüssels meldet', () => {
    const { result } = renderHook(() => useKartenFehler(1));
    let spaet: (e: unknown) => void = () => {};
    act(() => {
      result.current.beginne('zone-anlegen', 'Zone nicht angelegt')(new Error('a'));
      result.current.beginne('zone:2', 'Zone nicht gespeichert')(new Error('b'));
    });
    act(() => result.current.verwirf('zone-anlegen'));
    expect(result.current.gruende.map((g) => g.schluessel)).toEqual(['zone:2']);
    // Verwerfen eines unbekannten Schlüssels ändert nichts.
    const vorher = result.current.gruende;
    act(() => result.current.verwirf('verorten'));
    expect(result.current.gruende).toBe(vorher);
    act(() => {
      spaet = result.current.beginne('zone-anlegen', 'Zone nicht angelegt');
    });
    act(() => spaet(new Error('neu')));
    expect(result.current.gruende.map((g) => g.schluessel)).toEqual(['zone:2', 'zone-anlegen']);
  });
});
