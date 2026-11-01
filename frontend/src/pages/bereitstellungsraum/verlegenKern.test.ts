import { describe, expect, it } from 'vitest';
import type { BrListenEintrag } from '../../api/types';
import { VERLEGEN, verlegenEintrag, verlegenQuittung, zielRaeume } from './verlegenKern';

function raum(over: Partial<BrListenEintrag>): BrListenEintrag {
  return {
    id: 1,
    bezeichnung: 'BR Alpha',
    status: 'aktiv',
    storniert_at: null,
    ...over,
  } as BrListenEintrag;
}

describe('zielRaeume (LLH-1315)', () => {
  it('nur andere Räume in Betrieb, nicht storniert, nach Bezeichnung', () => {
    const liste = [
      raum({ id: 1, bezeichnung: 'BR Alpha' }),
      raum({ id: 2, bezeichnung: 'BR Nord' }),
      raum({ id: 3, bezeichnung: 'BR Süd', status: 'geplant' }),
      raum({ id: 4, bezeichnung: 'BR Ost', storniert_at: '2026-10-15 10:00:00' }),
      raum({ id: 5, bezeichnung: 'BR West', status: 'aufgeloest' }),
      raum({ id: 6, bezeichnung: 'BR Hafen' }),
    ];
    expect(zielRaeume(liste, 1).map((r) => r.id)).toEqual([6, 2]);
  });
});

describe('verlegenEintrag (LLH-1315)', () => {
  it('mit Ziel frei, ohne Ziel gesperrt mit Grund, ohne Liste gesperrt', () => {
    expect(verlegenEintrag([raum({ id: 2 })])).toEqual({ label: VERLEGEN, gesperrt: false });
    expect(verlegenEintrag([])).toEqual({
      label: 'In anderen BR verlegen (kein anderer Raum in Betrieb)',
      gesperrt: true,
    });
    expect(verlegenEintrag(null)).toEqual({
      label: 'In anderen BR verlegen (Räume nicht geladen)',
      gesperrt: true,
    });
  });
});

describe('verlegenQuittung (LLH-1315)', () => {
  it('nennt Art, Name und Zielraum', () => {
    expect(verlegenQuittung('einheit', 'HLF 20', 'BR Nord')).toBe(
      'Einheit „HLF 20“ nach BR Nord verlegt',
    );
    expect(verlegenQuittung('fahrzeug', 'Florian 1', 'BR Nord')).toBe(
      'Fahrzeug „Florian 1“ nach BR Nord verlegt',
    );
  });
});
