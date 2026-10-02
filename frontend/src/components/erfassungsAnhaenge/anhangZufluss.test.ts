import { describe, expect, it } from 'vitest';
import {
  freigegeben,
  nachgefuehrt,
  OFFENER_ZUFLUSS,
  teileZufluss,
  vorgemerkt,
  zuflussText,
  type AnhangZufluss,
} from './anhangZufluss';

const a = (id: number) => ({ id });
const stand = (gezeigt: number[] | null, eigene: number[] = []): AnhangZufluss => ({
  gezeigt: gezeigt == null ? null : new Set(gezeigt),
  eigene: new Set(eigene),
});
const ids = (xs: readonly { id: number }[]) => xs.map((x) => x.id);

describe('anhangZufluss (LFH-760)', () => {
  it('zeigt vor der ersten Lieferung alles', () => {
    const t = teileZufluss([a(2), a(1)], OFFENER_ZUFLUSS);
    expect(ids(t.sichtbar)).toEqual([2, 1]);
    expect(t.zurueckgehalten).toEqual([]);
  });

  it('hält eine fremde Ablage zurück und lässt die Folge der gezeigten stehen', () => {
    const t = teileZufluss([a(3), a(2), a(1)], stand([2, 1]));
    expect(ids(t.sichtbar)).toEqual([2, 1]);
    expect(ids(t.zurueckgehalten)).toEqual([3]);
  });

  it('zeigt eine eigene Ablage sofort', () => {
    const t = teileZufluss([a(4), a(3), a(2)], stand([2], [4]));
    expect(ids(t.sichtbar)).toEqual([4, 2]);
    expect(ids(t.zurueckgehalten)).toEqual([3]);
  });

  it('lässt eine entfallene Datei sofort weg', () => {
    const t = teileZufluss([a(1)], stand([2, 1]));
    expect(ids(t.sichtbar)).toEqual([1]);
    expect(t.zurueckgehalten).toEqual([]);
  });

  it('hält neben einer leeren Liste nichts zurück (kein Leerzustand neben „1 neue Datei“)', () => {
    const t = teileZufluss([a(3)], stand([]));
    expect(ids(t.sichtbar)).toEqual([3]);
    expect(t.zurueckgehalten).toEqual([]);
  });

  it('führt die gezeigte Menge nach und gibt null zurück, wenn nichts zu tun ist', () => {
    const neu = nachgefuehrt(stand([2, 1], [4]), [a(4), a(2), a(1)]);
    expect(neu).toEqual(stand([4, 2, 1]));
    expect(nachgefuehrt(neu!, [a(4), a(2), a(1)])).toBeNull();
  });

  it('behält eine vorgemerkte eigene Ablage, bis sie gezeigt ist', () => {
    expect(nachgefuehrt(stand([2], [4]), [a(2)])).toBeNull();
  });

  it('gibt auf „anzeigen“ die ganze Liste frei und behält die Vormerkungen', () => {
    expect(freigegeben(stand([2], [9]), [a(3), a(2)])).toEqual(stand([3, 2], [9]));
  });

  it('merkt eine eigene Ablage vor, auch vor der ersten Lieferung', () => {
    expect(vorgemerkt(OFFENER_ZUFLUSS, 7)).toEqual(stand(null, [7]));
  });

  it('nennt die Zahl im Singular und Plural', () => {
    expect(zuflussText(1)).toBe('1 neue Datei');
    expect(zuflussText(3)).toBe('3 neue Dateien');
  });
});
