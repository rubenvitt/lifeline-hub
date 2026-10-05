import { describe, expect, it } from 'vitest';
import { RAND, SCHIENE_LINIE_VERSATZ, type Platz } from '../fernmeldeskizzeLayout';
import {
  LOESE_ABSTAND,
  SCHIENEN_TOLERANZ,
  abstandZurSchiene,
  aufRaster,
  elementRechteck,
  flaechenAusdehnung,
  schieneAn,
  schienenLageAb,
  stelleAn,
  stichleitungsPunkte,
  umfassend,
  zeichenMitte,
} from './geometrie';

function platz(p: Partial<Platz>): Platz {
  return {
    x: 0,
    y: 0,
    breite: 100,
    hoehe: 80,
    quelle: 'auto',
    neu: false,
    steigX: null,
    zeichenX: null,
    ...p,
  };
}

const SCHIENE = platz({ x: 100, y: 200, breite: 400, hoehe: 64 });
const LINIE = 200 + SCHIENE_LINIE_VERSATZ;

describe('Stichleitung', () => {
  it('aus der eigenen Steigleitung: waagerecht hinein, senkrecht auf die Linie', () => {
    const stelle = platz({ x: 160, y: 40, steigX: 140 });
    const pkt = stichleitungsPunkte({ art: 'abschnitt' }, stelle, SCHIENE);
    const mitte = zeichenMitte({ art: 'abschnitt' }, stelle);
    expect(pkt).toEqual([
      { x: 160, y: mitte.y },
      { x: 140, y: mitte.y },
      { x: 140, y: LINIE },
    ]);
  });

  it('Führungsstelle (Steigleitung in der Mitte): senkrecht unten heraus', () => {
    const stelle = platz({ x: 200, y: 40, steigX: 250 });
    expect(stichleitungsPunkte({ art: 'fuehrungsstelle' }, stelle, SCHIENE)).toEqual([
      { x: 250, y: 120 },
      { x: 250, y: LINIE },
    ]);
  });

  it('verschoben über der Schiene: senkrecht aus der Mitte', () => {
    const stelle = platz({ x: 300, y: 400 });
    expect(stichleitungsPunkte({ art: 'einheit' }, stelle, SCHIENE)).toEqual([
      { x: 350, y: 400 },
      { x: 350, y: LINIE },
    ]);
  });

  it('neben der Schiene: waagerecht bis an ihr Ende, dann auf die Linie', () => {
    const stelle = platz({ x: 700, y: 100 });
    const pkt = stichleitungsPunkte({ art: 'extern' }, stelle, SCHIENE);
    const ay = zeichenMitte({ art: 'extern' }, stelle).y;
    expect(pkt).toEqual([
      { x: 700, y: ay },
      { x: 500, y: ay },
      { x: 500, y: LINIE },
    ]);
  });

  it('der letzte Punkt liegt immer auf der Linie, innerhalb ihrer Länge', () => {
    for (const stelle of [
      platz({ x: -300, y: 0, steigX: -320 }),
      platz({ x: 900, y: 600, steigX: 880 }),
      platz({ x: 120, y: 500 }),
      platz({ x: 0, y: LINIE - 40 }),
    ]) {
      const pkt = stichleitungsPunkte({ art: 'einheit' }, stelle, SCHIENE);
      const letzter = pkt[pkt.length - 1];
      expect(letzter.y).toBe(LINIE);
      expect(letzter.x).toBeGreaterThanOrEqual(100);
      expect(letzter.x).toBeLessThanOrEqual(500);
    }
  });
});

describe('Treffer beim Ablegen', () => {
  const plaetze = new Map<string, Platz>([
    ['sg-1', SCHIENE],
    ['sg-2', platz({ x: 100, y: 300, breite: 400, hoehe: 64 })],
    ['ab-1', platz({ x: 100, y: 0, breite: 176, hoehe: 120 })],
    ['eh-2', platz({ x: 150, y: 50, breite: 144, hoehe: 80 })],
  ]);

  it('trifft die nächste Schiene innerhalb der Toleranz', () => {
    expect(schieneAn(['sg-1', 'sg-2'], plaetze, { x: 300, y: LINIE + 3 })).toBe('sg-1');
    expect(
      schieneAn(['sg-1', 'sg-2'], plaetze, { x: 300, y: 300 + SCHIENE_LINIE_VERSATZ - 2 }),
    ).toBe('sg-2');
  });

  it('trifft nichts außerhalb der Toleranz oder neben der Schiene', () => {
    expect(schieneAn(['sg-1'], plaetze, { x: 300, y: LINIE + SCHIENEN_TOLERANZ + 1 })).toBeNull();
    expect(schieneAn(['sg-1'], plaetze, { x: 600, y: LINIE })).toBeNull();
  });

  it('Lösen braucht mehr Abstand als das Treffen', () => {
    expect(LOESE_ABSTAND).toBeGreaterThan(SCHIENEN_TOLERANZ);
    expect(abstandZurSchiene({ x: 300, y: LINIE + LOESE_ABSTAND }, SCHIENE)).toBe(LOESE_ABSTAND);
  });

  it('trifft die Stelle, in deren Platz losgelassen wird, die zuletzt gezeichnete zuerst', () => {
    expect(stelleAn(['ab-1', 'eh-2'], plaetze, { x: 160, y: 60 })).toBe('eh-2');
    expect(stelleAn(['ab-1', 'eh-2'], plaetze, { x: 110, y: 10 })).toBe('ab-1');
    expect(stelleAn(['ab-1', 'eh-2'], plaetze, { x: 160, y: 60 }, 'eh-2')).toBe('ab-1');
    expect(stelleAn(['ab-1', 'eh-2'], plaetze, { x: 900, y: 900 })).toBeNull();
  });
});

describe('Raster und Rechtecke', () => {
  it('rastet auf 8', () => {
    expect(aufRaster(13)).toBe(16);
    expect(aufRaster(11)).toBe(8);
    expect(aufRaster(-3)).toBe(-0);
  });

  it('eine Schiene aus der Palette beginnt am Ablegepunkt, ihre Linie liegt auf ihm', () => {
    const lage = schienenLageAb({ x: 203, y: 299 });
    expect(lage.x).toBe(200);
    expect(lage.y).toBe(272);
    expect(lage.y + SCHIENE_LINIE_VERSATZ).toBe(aufRaster(299));
  });

  it('umfassendes Rechteck', () => {
    expect(
      umfassend([
        { x: 10, y: 20, breite: 10, hoehe: 10 },
        { x: 0, y: 25, breite: 5, hoehe: 30 },
      ]),
    ).toEqual({ x: 0, y: 20, breite: 20, hoehe: 35 });
    expect(umfassend([])).toBeNull();
  });
});

describe('Ausdehnung und Schriftfeld (2.5, 4.2)', () => {
  it('das Schriftfeld steht unten rechts unter allem, die Ausdehnung umfasst es', () => {
    const r = flaechenAusdehnung({ breite: 800, hoehe: 400 }, [], { breite: 336, hoehe: 120 });
    expect(r.schriftfeld).toEqual({ x: 800 - RAND - 336, y: 400 });
    expect(r.inhalt).toEqual({ breite: 800, hoehe: 400 + 120 + RAND });
  });

  it('ein Bereich jenseits des Layouts erweitert die Ausdehnung; ein schmales Layout wächst auf das Schriftfeld', () => {
    const r = flaechenAusdehnung(
      { breite: 200, hoehe: 100 },
      [{ x: 100, y: 500, breite: 200, hoehe: 100 }],
      { breite: 336, hoehe: 120 },
    );
    expect(r.inhalt.breite).toBe(336 + 2 * RAND);
    expect(r.schriftfeld.y).toBe(600 + RAND);
    expect(r.inhalt.hoehe).toBe(600 + RAND + 120 + RAND);
  });

  it('Rechteck je Element: Stelle, Stichleitung (ihre Stelle), Verbindung (beide Enden), Bereich, Schriftfeld', () => {
    const plaetze = new Map([
      ['ab-1', platz({ x: 10, y: 20, breite: 100, hoehe: 50 })],
      ['ks-5', platz({ x: 300, y: 400, breite: 100, hoehe: 50 })],
    ]);
    const sf = { x: 500, y: 600, breite: 336, hoehe: 120 };
    const netz = {
      verbindungen: [{ key: 'vb-8', von: 'ab-1', nach: 'ks-5' }],
      bereiche: [{ key: 'be-4', x: 1, y: 2, breite: 3, hoehe: 4 }],
    };
    expect(elementRechteck(netz, plaetze, sf, 'ab-1')).toEqual({
      x: 10,
      y: 20,
      breite: 100,
      hoehe: 50,
    });
    expect(elementRechteck(netz, plaetze, sf, 'sg-2~ks-5')).toEqual({
      x: 300,
      y: 400,
      breite: 100,
      hoehe: 50,
    });
    expect(elementRechteck(netz, plaetze, sf, 'vb-8')).toEqual({
      x: 10,
      y: 20,
      breite: 390,
      hoehe: 430,
    });
    expect(elementRechteck(netz, plaetze, sf, 'be-4')).toEqual({ x: 1, y: 2, breite: 3, hoehe: 4 });
    expect(elementRechteck(netz, plaetze, sf, 'schriftfeld')).toEqual(sf);
    expect(elementRechteck(netz, plaetze, sf, 'eh-99')).toBeNull();
  });
});
