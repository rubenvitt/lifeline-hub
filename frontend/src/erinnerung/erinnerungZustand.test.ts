import { describe, expect, it } from 'vitest';
import type { Erinnerung } from '../api/types';
import { GRUPPE_LABEL } from '../kommunikation';
import { ERINNERUNG_GRUPPE_LABEL, erinnerungZustand } from './erinnerungZustand';

const JETZT = Date.UTC(2026, 10, 15, 14, 0);
const erinnerung = (over: Partial<Erinnerung>): Erinnerung =>
  ({
    id: 1,
    status: 'offen',
    ist_faellig: false,
    faellig_at: '2026-11-15 14:10:00',
    ...over,
  }) as Erinnerung;

describe('erinnerungZustand (LLH-1749)', () => {
  it('vor der Fälligkeit „bald“ ohne Ton', () => {
    expect(erinnerungZustand(erinnerung({}), JETZT)).toEqual({ wort: 'bald', ton: null });
  });

  it('ab der Fälligkeit „fällig“ in Achtung — auch ohne neuen Abruf (Seitenuhr)', () => {
    expect(erinnerungZustand(erinnerung({ faellig_at: '2026-11-15 14:00:00' }), JETZT)).toEqual({
      wort: 'fällig',
      ton: 'achtung',
    });
    expect(erinnerungZustand(erinnerung({ faellig_at: '2026-11-15 12:00:00' }), JETZT)).toEqual({
      wort: 'fällig',
      ton: 'achtung',
    });
  });

  it('folgt dem Server, wenn er „fällig“ meldet', () => {
    expect(erinnerungZustand(erinnerung({ ist_faellig: true }), JETZT)).toEqual({
      wort: 'fällig',
      ton: 'achtung',
    });
  });

  it('nie „überfällig“ und nie Alarm — das bleibt Fristen mit Soll-Charakter', () => {
    const z = erinnerungZustand(erinnerung({ faellig_at: '2026-11-14 08:00:00' }), JETZT);
    expect(z.wort).not.toBe('überfällig');
    expect(z.ton).not.toBe('alarm');
  });
});

describe('ERINNERUNG_GRUPPE_LABEL (LLH-1911)', () => {
  it('nennt die erste Gruppe „Fällig“, nie „Überfällig“ — eine Erinnerung ist ein Wecker', () => {
    expect(ERINNERUNG_GRUPPE_LABEL.ueberfaellig).toBe('Fällig');
    expect(Object.values(ERINNERUNG_GRUPPE_LABEL)).not.toContain('Überfällig');
  });

  it('übernimmt die übrigen Gruppen der Kommunikations-Module unverändert', () => {
    expect(ERINNERUNG_GRUPPE_LABEL.heute).toBe(GRUPPE_LABEL.heute);
    expect(ERINNERUNG_GRUPPE_LABEL.spaeter).toBe(GRUPPE_LABEL.spaeter);
    expect(ERINNERUNG_GRUPPE_LABEL.ohne_frist).toBe(GRUPPE_LABEL.ohne_frist);
  });
});
