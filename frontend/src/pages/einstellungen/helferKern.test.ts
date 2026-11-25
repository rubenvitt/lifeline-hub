import { describe, expect, it } from 'vitest';
import type { HelferAnzeige } from '../../api/types';
import {
  EINLADUNG_VORGABE_MINUTEN,
  findTracker,
  helferGruppe,
  sortHelfer,
  suggestPerson,
} from './helferKern';

const helfer = (id: number, state: HelferAnzeige['state'], created_at: string, extra = {}) =>
  ({
    id,
    state,
    created_at,
    display_name: `Kraft ${id}`,
    expires_at: '2026-11-25 20:00:00',
    is_tracker: false,
    paused: false,
    person_requested: false,
    ...extra,
  }) as HelferAnzeige;

describe('Helfer der Leitung (Helfer-App)', () => {
  it('ordnet „Wartet“ vor „Angemeldet“ vor „Beendet“, je Gruppe nach dem Anmelden', () => {
    const liste = [
      helfer(1, 'beendet', '2026-11-25 08:00:00'),
      helfer(2, 'aktiv', '2026-11-25 09:00:00'),
      helfer(3, 'unbestaetigt', '2026-11-25 10:00:00'),
      helfer(4, 'abgelehnt', '2026-11-25 07:00:00'),
      helfer(5, 'aktiv', '2026-11-25 08:30:00'),
      helfer(6, 'unbestaetigt', '2026-11-25 09:30:00'),
    ];
    expect(sortHelfer(liste).map((h) => h.id)).toEqual([6, 3, 5, 2, 4, 1]);
    // Die Eingabe bleibt, wie sie war.
    expect(liste.map((h) => h.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('nennt die Gruppe eines Zustands', () => {
    expect(helferGruppe('unbestaetigt')).toBe('wartet');
    expect(helferGruppe('aktiv')).toBe('angemeldet');
    expect(helferGruppe('abgelehnt')).toBe('beendet');
    expect(helferGruppe('beendet')).toBe('beendet');
  });

  it('schlägt die Person mit gleichem Namen vor, ohne Groß- und Kleinschreibung', () => {
    const kraefte = [
      { id: 1, name: 'Anna Berg' },
      { id: 2, name: 'Max Muster' },
    ];
    expect(suggestPerson('  max  MUSTER ', kraefte)).toBe(2);
  });

  it('schlägt nach dem ersten Wort vor, wenn es nur eine Kraft trifft', () => {
    const kraefte = [
      { id: 1, name: 'Anna Berg' },
      { id: 2, name: 'Max Muster' },
      { id: 3, name: 'Moritz Muster' },
    ];
    expect(suggestPerson('max', kraefte)).toBe(2);
    expect(suggestPerson('Max M.', kraefte)).toBe(2);
    // Zwei Kräfte mit demselben ersten Wort: kein Vorschlag, die Leitung wählt.
    expect(
      suggestPerson('Muster', [
        ...kraefte,
        { id: 4, name: 'muster, Eva' },
        { id: 5, name: 'Muster Jan' },
      ]),
    ).toBeNull();
    expect(suggestPerson('Paul', kraefte)).toBeNull();
    expect(suggestPerson('', kraefte)).toBeNull();
  });

  it('findet das Ortungsgerät desselben Ziels unter den angemeldeten Helfern', () => {
    const ziel = { kind: 'vehicle' as const, id: 7, name: 'Rotkreuz 1/83-1' };
    const liste = [
      helfer(1, 'aktiv', '2026-11-25 08:00:00', { is_tracker: true, target: ziel }),
      helfer(2, 'unbestaetigt', '2026-11-25 09:00:00', { target: ziel }),
      helfer(3, 'beendet', '2026-11-25 07:00:00', { is_tracker: true, target: ziel }),
      helfer(4, 'aktiv', '2026-11-25 07:00:00', {
        is_tracker: true,
        target: { kind: 'unit', id: 7, name: 'Zug 1' },
      }),
    ];
    expect(findTracker(liste, ziel, 2)?.id).toBe(1);
    expect(findTracker(liste, ziel, 1)).toBeUndefined();
    expect(findTracker(liste, null, 2)).toBeUndefined();
  });

  it('lädt vier Stunden als Vorgabe der Einladung', () => {
    expect(EINLADUNG_VORGABE_MINUTEN).toBe(240);
  });
});
