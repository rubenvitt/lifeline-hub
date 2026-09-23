import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { Abloesung } from '../api/types';
import { freigegeben, nachgefuehrt, teileZufluss, zuflussText, type Zuflussstand } from './zufluss';

dayjs.extend(utc);

const jetzt = dayjs.utc('2026-09-22 12:00:00');

function schicht(id: number, faellig_at = '2026-09-22 18:00:00'): Abloesung {
  return {
    id,
    einsatz_id: 1,
    einheit_id: 10 + id,
    einheit_name: `Florian ${id}`,
    beginn_at: '2026-09-22 09:30:00',
    rhythmus_minuten: 360,
    rhythmus_quelle: 'einheit',
    faellig_at,
    status: 'laufend',
    ruecknehmbar: false,
    angelegt_at: '2026-09-22 09:30:00',
  };
}

const stand = (gezeigt: number[] | null, eigene: number[] = []): Zuflussstand => ({
  gezeigt: gezeigt == null ? null : new Set(gezeigt),
  eigene: new Set(eigene),
});
const ids = (xs: readonly Abloesung[]) => xs.map((s) => s.id);

describe('teileZufluss — fremde Neuzugänge warten hinter dem Sammelbanner (LFH-647)', () => {
  it('ohne Stand (erste Lieferung) steht alles', () => {
    const r = teileZufluss([schicht(1), schicht(2)], stand(null));
    expect(ids(r.sichtbar)).toEqual([1, 2]);
    expect(r.zurueckgehalten).toEqual([]);
  });

  it('hält eine fremde neue Schicht zurück, auch wenn sie OBEN einsortiert ist', () => {
    const r = teileZufluss([schicht(9), schicht(1), schicht(2)], stand([1, 2]));
    expect(ids(r.sichtbar)).toEqual([1, 2]);
    expect(ids(r.zurueckgehalten)).toEqual([9]);
  });

  it('eine eigene neue Schicht steht sofort, an ihrem Fälligkeitsplatz', () => {
    const r = teileZufluss([schicht(9), schicht(1), schicht(2)], stand([1, 2], [9]));
    expect(ids(r.sichtbar)).toEqual([9, 1, 2]);
    expect(r.zurueckgehalten).toEqual([]);
  });

  it('Entfallene fallen sofort weg; die Gezeigten behalten die Server-Ordnung', () => {
    const r = teileZufluss([schicht(2), schicht(1)], stand([1, 2, 3]));
    expect(ids(r.sichtbar)).toEqual([2, 1]);
  });

  it('bei null gezeigten Karten hält nichts zurück — es steht kein Cursor über einer Karte', () => {
    const r = teileZufluss([schicht(9)], stand([]));
    expect(ids(r.sichtbar)).toEqual([9]);
    expect(r.zurueckgehalten).toEqual([]);
    // Auch wenn alle gezeigten entfallen sind: der Leerzustand darf nicht neben einem Banner stehen.
    expect(ids(teileZufluss([schicht(9)], stand([1])).sichtbar)).toEqual([9]);
  });
});

describe('nachgefuehrt — der gezeigte Stand folgt der sichtbaren Menge', () => {
  it('unverändert ergibt null (kein Zustandswechsel, keine Render-Schleife)', () => {
    const s = stand([1, 2]);
    expect(nachgefuehrt(s, [schicht(1), schicht(2)])).toBeNull();
  });

  it('die erste Lieferung wird zum gezeigten Stand', () => {
    const n = nachgefuehrt(stand(null), [schicht(1), schicht(2)]);
    expect([...n!.gezeigt!]).toEqual([1, 2]);
  });

  it('eine sichtbar gewordene eigene Schicht wandert von „eigene" nach „gezeigt"', () => {
    const n = nachgefuehrt(stand([1], [9]), [schicht(9), schicht(1)]);
    expect([...n!.gezeigt!].sort()).toEqual([1, 9]);
    expect([...n!.eigene]).toEqual([]);
  });

  it('eine noch nicht eingetroffene eigene Schicht bleibt vorgemerkt', () => {
    const n = nachgefuehrt(stand([1], [9]), [schicht(1)]);
    expect(n).toBeNull();
  });

  it('eine entfallene Karte verlässt den Stand — kehrt sie fremd zurück, ist sie Zuwachs', () => {
    // Fremder Vollzug nimmt 1 weg …
    const n = nachgefuehrt(stand([1, 2]), [schicht(2)]);
    expect([...n!.gezeigt!]).toEqual([2]);
    // … fremde Rücknahme bringt sie oberhalb zurück: das wäre ein Sprung, also Banner.
    const r = teileZufluss([schicht(1), schicht(2)], n!);
    expect(ids(r.sichtbar)).toEqual([2]);
    expect(ids(r.zurueckgehalten)).toEqual([1]);
  });
});

describe('freigegeben — Banner oder Ansichtswechsel zeigen alles', () => {
  it('nimmt die volle Menge in den Stand und behält vorgemerkte eigene', () => {
    const n = freigegeben(stand([1], [7]), [schicht(9), schicht(1)]);
    expect([...n.gezeigt!]).toEqual([9, 1]);
    expect([...n.eigene]).toEqual([7]);
    expect(ids(teileZufluss([schicht(9), schicht(1)], n).sichtbar)).toEqual([9, 1]);
  });
});

describe('zuflussText', () => {
  it('Einzahl, Mehrzahl und fällige Zurückgehaltene', () => {
    expect(zuflussText([schicht(1)], jetzt)).toBe('1 neue Schicht');
    expect(zuflussText([schicht(1), schicht(2)], jetzt)).toBe('2 neue Schichten');
    // Eine zurückgehaltene fällige Schicht darf nicht still hinter dem Banner warten
    // (Prüfliste Kriterium 9): das Banner nennt sie.
    expect(zuflussText([schicht(1, '2026-09-22 11:50:00'), schicht(2)], jetzt)).toBe(
      '2 neue Schichten, davon 1 fällig',
    );
  });
});
