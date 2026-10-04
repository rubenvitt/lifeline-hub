import { describe, expect, it } from 'vitest';
import type { BaumKnoten } from './baum';
import { schleuse, wartendText } from './baumSchleuse';

interface K extends BaumKnoten<K> {
  name: string;
}

const k = (key: string, kinder: K[] = [], name = key.toUpperCase()): K => ({ key, name, kinder });

/** Schlüssel und Namen als lesbare Gliederung: `a(A)[a1(A1)]`. */
function form(knoten: readonly K[]): string {
  return knoten
    .map((x) => `${x.key}(${x.name})${x.kinder.length > 0 ? `[${form(x.kinder)}]` : ''}`)
    .join(' ');
}

const STAND = [k('a', [k('a1'), k('a2')]), k('b', [k('b1')]), k('sammel', [k('e9')])];

describe('baumSchleuse — offen', () => {
  it('gibt bei offener Schleuse den frischen Baum selbst zurück, nichts wartet', () => {
    const frisch = [k('a', [k('a1')]), k('neu')];
    const s = schleuse(null, frisch);
    expect(s.gezeigt).toBe(frisch);
    expect(s.wartend).toEqual({ neu: 0, umgehaengt: 0, entfallen: 0 });
    expect(s.entfallen.size).toBe(0);
  });
});

describe('baumSchleuse — gehalten', () => {
  it('ohne Abweichung zeigt sie die gehaltene Gliederung, nichts wartet', () => {
    const s = schleuse(STAND, structuredClone(STAND));
    expect(form(s.gezeigt)).toBe(form(STAND));
    expect(s.wartend).toEqual({ neu: 0, umgehaengt: 0, entfallen: 0 });
  });

  it('hält einen neuen Knoten zurück, auch ein neues Kind, und zählt beide als neu', () => {
    const frisch = [
      k('a', [k('a1'), k('a2'), k('a3')]),
      k('b', [k('b1')]),
      k('c'),
      k('sammel', [k('e9')]),
    ];
    const s = schleuse(STAND, frisch);
    expect(form(s.gezeigt)).toBe(form(STAND));
    expect(s.wartend).toEqual({ neu: 2, umgehaengt: 0, entfallen: 0 });
  });

  it('lässt einen umgehängten Knoten am gehaltenen Ort und zählt ihn als umgehängt', () => {
    // a2 wandert unter b, e9 aus dem Sammelknoten unter a.
    const frisch = [k('a', [k('a1'), k('e9')]), k('b', [k('b1'), k('a2')]), k('sammel', [])];
    const s = schleuse(STAND, frisch);
    expect(form(s.gezeigt)).toBe(form(STAND));
    expect(s.wartend).toEqual({ neu: 0, umgehaengt: 2, entfallen: 0 });
  });

  it('zählt den Wechsel zwischen Wurzel und Kind als umgehängt', () => {
    const frisch = [k('a', [k('a1'), k('a2')]), k('b'), k('b1'), k('sammel', [k('e9')])];
    expect(schleuse(STAND, frisch).wartend).toEqual({ neu: 0, umgehaengt: 1, entfallen: 0 });
  });

  it('lässt einen entfallenen Knoten mit letztem Inhalt und Marke stehen, seine Kinder unter ihm', () => {
    // a ist aufgelöst; a1 steht frisch als Waise an der Wurzel und hat einen neuen Namen.
    const frisch = [k('a1', [], 'A1 neu'), k('b', [k('b1')]), k('sammel', [k('e9')])];
    const s = schleuse(STAND, frisch);
    expect(form(s.gezeigt)).toBe('a(A)[a1(A1 neu) a2(A2)] b(B)[b1(B1)] sammel(SAMMEL)[e9(E9)]');
    expect([...s.entfallen].sort()).toEqual(['a', 'a2']);
    expect(s.wartend).toEqual({ neu: 0, umgehaengt: 1, entfallen: 2 });
  });

  it('hält einen Sammelknoten wie jeden Knoten', () => {
    const frisch = [k('a', [k('a1'), k('a2')]), k('b', [k('b1'), k('e9')])];
    const s = schleuse(STAND, frisch);
    expect(form(s.gezeigt)).toBe(form(STAND));
    expect([...s.entfallen]).toEqual(['sammel']);
    expect(s.wartend).toEqual({ neu: 0, umgehaengt: 1, entfallen: 1 });
  });

  it('lässt den Inhalt fließen und hält die Folge, auch wenn die frische umsortiert ist', () => {
    const frisch = [
      k('sammel', [k('e9', [], 'E9 umbenannt')]),
      k('b', [k('b1')], 'B neu'),
      k('a', [k('a2'), k('a1')]),
    ];
    const s = schleuse(STAND, frisch);
    expect(form(s.gezeigt)).toBe(
      'a(A)[a1(A1) a2(A2)] b(B neu)[b1(B1)] sammel(SAMMEL)[e9(E9 umbenannt)]',
    );
    expect(s.wartend).toEqual({ neu: 0, umgehaengt: 0, entfallen: 0 });
  });

  it('gibt den frischen Knoten weiter, nur mit den gehaltenen Kindern', () => {
    const frischA = { ...k('a', [k('a1'), k('a2')]), extra: 7 };
    const s = schleuse(STAND, [frischA, k('b', [k('b1')]), k('sammel', [k('e9')])]);
    expect((s.gezeigt[0] as K & { extra?: number }).extra).toBe(7);
  });
});

describe('wartendText', () => {
  it('nennt nur Teile über 0 in fester Folge', () => {
    expect(wartendText({ neu: 2, umgehaengt: 1, entfallen: 1 })).toBe(
      '2 neu · 1 umgehängt · 1 entfallen',
    );
    expect(wartendText({ neu: 0, umgehaengt: 3, entfallen: 0 })).toBe('3 umgehängt');
    expect(wartendText({ neu: 0, umgehaengt: 0, entfallen: 1 })).toBe('1 entfallen');
  });

  it('ist ohne Wartendes null', () => {
    expect(wartendText({ neu: 0, umgehaengt: 0, entfallen: 0 })).toBeNull();
  });
});
