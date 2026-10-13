import { describe, expect, it } from 'vitest';
import type { InfotelefonAnruf } from '../api/types';
import { einfrieren, erweitere, teileZufluss, zuflussText } from './zufluss';

const a = (id: number, von = 1) =>
  ({ id, angelegt_von_id: von, anliegen: 'hinweis', status: 'erledigt' }) as InfotelefonAnruf;

describe('Zufluss der Anruf-Zeitachse (LFH-554)', () => {
  it('lässt ohne Einfrieren alles durch', () => {
    expect(teileZufluss([a(2), a(1)], null)).toEqual({
      sichtbar: [a(2), a(1)],
      zurueckgehalten: 0,
    });
  });

  it('hält neue fremde Anrufe zurück, eigene stehen sofort', () => {
    const gefroren = einfrieren([a(2), a(1)]);
    const { sichtbar, zurueckgehalten } = teileZufluss([a(4, 9), a(3, 7), a(2), a(1)], gefroren, 7);
    expect(sichtbar.map((x) => x.id)).toEqual([3, 2, 1]);
    expect(zurueckgehalten).toBe(1);
  });

  it('nimmt eine ältere Seite auf, ohne neue fremde Anrufe freizugeben (LLH-732)', () => {
    // Eingefroren: 20 und 19. „Ältere laden“ bringt den Nachtrag 30 (alter Eingang, hohe
    // Kennung) und 18; gleichzeitig ist der fremde Anruf 31 eingegangen.
    const gefroren = erweitere(einfrieren([a(20), a(19)]), [a(30, 9), a(18)]);
    const { sichtbar, zurueckgehalten } = teileZufluss(
      [a(31, 9), a(20), a(19), a(30, 9), a(18)],
      gefroren,
      7,
    );
    expect(sichtbar.map((x) => x.id)).toEqual([20, 19, 30, 18]);
    expect(zurueckgehalten).toBe(1);
    expect(gefroren?.wassermarke).toBe(20);
  });

  it('erweitert ohne eingefrorenen Stand nichts', () => {
    expect(erweitere(null, [a(1)])).toBeNull();
  });

  it('friert eine leere Liste nicht ein', () => {
    expect(einfrieren([])).toBeNull();
  });

  it('zählt im Wortlaut', () => {
    expect(zuflussText(1)).toBe('1 neuer Anruf');
    expect(zuflussText(3)).toBe('3 neue Anrufe');
  });
});
