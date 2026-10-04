import { describe, expect, it, vi } from 'vitest';
import type { Drawing } from '@einsatzzeichen/schema';
import type { ZeichenQuelle } from './markerIcons';
import { beobachtePixeldichte, rastereZeichenNeu, type ZeichenKarte } from './zeichenDichte';

/** Ein Fenster, dessen Pixeldichte der Test von Hand wechselt — wie ein Monitor- oder Zoomwechsel. */
function testFenster(start: number) {
  const abfragen: { media: string; hoerer: Set<() => void> }[] = [];
  const fenster = {
    devicePixelRatio: start,
    matchMedia: (media: string) => {
      const eintrag = { media, hoerer: new Set<() => void>() };
      abfragen.push(eintrag);
      return {
        addEventListener: (_typ: 'change', h: () => void) => eintrag.hoerer.add(h),
        removeEventListener: (_typ: 'change', h: () => void) => eintrag.hoerer.delete(h),
      };
    },
  };
  const wechsle = (neu: number) => {
    const vorher = fenster.devicePixelRatio;
    fenster.devicePixelRatio = neu;
    // Nur die Abfrage auf die alte Dichte kippt, und nur sie meldet sich.
    for (const a of abfragen) {
      if (a.media === `(resolution: ${vorher}dppx)`) for (const h of [...a.hoerer]) h();
    }
  };
  const aktiveHoerer = () => abfragen.reduce((n, a) => n + a.hoerer.size, 0);
  return { fenster, wechsle, abfragen, aktiveHoerer };
}

describe('beobachtePixeldichte', () => {
  it('meldet jeden Wechsel mit der neuen Dichte, auch mehrere hintereinander', () => {
    const t = testFenster(1);
    const onWechsel = vi.fn();
    beobachtePixeldichte(t.fenster, onWechsel);
    expect(t.abfragen[t.abfragen.length - 1].media).toBe('(resolution: 1dppx)');

    t.wechsle(2);
    expect(onWechsel).toHaveBeenLastCalledWith(2);
    // Die Abfrage gilt der Dichte, die gerade herrscht; sonst käme der zweite Wechsel nie an.
    expect(t.abfragen[t.abfragen.length - 1].media).toBe('(resolution: 2dppx)');

    t.wechsle(1.25);
    expect(onWechsel).toHaveBeenLastCalledWith(1.25);
    expect(onWechsel).toHaveBeenCalledTimes(2);
    expect(t.aktiveHoerer()).toBe(1);
  });

  it('hört nach dem Abmelden nicht mehr zu', () => {
    const t = testFenster(1);
    const onWechsel = vi.fn();
    const abmelden = beobachtePixeldichte(t.fenster, onWechsel);
    t.wechsle(2);
    abmelden();
    expect(t.aktiveHoerer()).toBe(0);
    t.wechsle(3);
    expect(onWechsel).toHaveBeenCalledTimes(1);
  });

  it('tut ohne matchMedia nichts und wirft nicht', () => {
    const abmelden = beobachtePixeldichte({ devicePixelRatio: 1 }, vi.fn());
    expect(() => abmelden()).not.toThrow();
  });
});

const ZEICHNUNG = { kind: 'test' } as unknown as Drawing;

/** Karte mit Bildliste; `add`/`remove` protokollieren die Reihenfolge. */
function testKarte(ids: string[], geladen = true) {
  const bilder = new Set(ids);
  const protokoll: string[] = [];
  const karte: ZeichenKarte = {
    listImages: () => {
      if (!geladen) throw new Error('Style is not done loading');
      return [...bilder];
    },
    hasImage: (id) => bilder.has(id),
    addImage: (id) => {
      bilder.add(id);
    },
    removeImage: (id) => {
      bilder.delete(id);
      protokoll.push(`weg ${id}`);
    },
  };
  return { karte, bilder, protokoll };
}

describe('rastereZeichenNeu', () => {
  const registry = new Map<string, ZeichenQuelle>([
    ['ez|a', { art: 'ez', drawing: ZEICHNUNG }],
    ['ez|b', { art: 'ez', drawing: ZEICHNUNG }],
    ['tz|c', { art: 'tz', tz: { grundzeichen: 'anlass' } }],
  ]);

  it('ersetzt jedes registrierte ez|-Bild in der neuen Dichte und lässt die übrigen stehen', () => {
    const t = testKarte(['ez|a', 'ez|b', 'tz|c', 'plakette|x']);
    const zeichne = vi.fn((_karte: ZeichenKarte, id: string) => {
      t.bilder.add(id);
      t.protokoll.push(`neu ${id}`);
    });
    rastereZeichenNeu(t.karte, registry, 2, zeichne);

    expect(zeichne).toHaveBeenCalledTimes(2);
    expect(zeichne).toHaveBeenCalledWith(t.karte, 'ez|a', ZEICHNUNG, {
      size: 34,
      pixelRatio: 2,
    });
    // Erst entfernen, dann anlegen: `addSymbolImage` wirft auf eine belegte ID.
    expect(t.protokoll).toEqual(['weg ez|a', 'neu ez|a', 'weg ez|b', 'neu ez|b']);
    expect([...t.bilder].sort()).toEqual(['ez|a', 'ez|b', 'plakette|x', 'tz|c']);
  });

  it('lässt ein ez|-Bild ohne Quelle in der Registry stehen', () => {
    const t = testKarte(['ez|fremd']);
    const zeichne = vi.fn();
    rastereZeichenNeu(t.karte, registry, 2, zeichne);
    expect(zeichne).not.toHaveBeenCalled();
    expect(t.bilder.has('ez|fremd')).toBe(true);
  });

  it('tut während eines Stilwechsels nichts (der neue Stil rastert ohnehin in der aktuellen Dichte)', () => {
    const t = testKarte(['ez|a'], false);
    const zeichne = vi.fn();
    expect(() => rastereZeichenNeu(t.karte, registry, 2, zeichne)).not.toThrow();
    expect(zeichne).not.toHaveBeenCalled();
    expect(t.bilder.has('ez|a')).toBe(true);
  });

  it('fängt einen Rasterfehler je Bild ab und macht mit dem nächsten weiter', () => {
    const t = testKarte(['ez|a', 'ez|b']);
    const zeichne = vi.fn((_karte: ZeichenKarte, id: string) => {
      if (id === 'ez|a') throw new Error('kaputt');
      t.bilder.add(id);
    });
    expect(() => rastereZeichenNeu(t.karte, registry, 2, zeichne)).not.toThrow();
    // Das kaputte Bild fehlt jetzt; der Resolver versucht es beim nächsten Layout erneut.
    expect(t.bilder.has('ez|a')).toBe(false);
    expect(t.bilder.has('ez|b')).toBe(true);
  });
});
