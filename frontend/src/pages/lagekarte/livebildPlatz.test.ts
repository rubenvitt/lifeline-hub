import { describe, expect, it } from 'vitest';
import { LIVEBILD_MIN_HOEHE, livebildMaxBreite } from './livebildPlatz';

// Maße wie am Handschirm 390 × 844 (LLH-2137): Karte 175–535, Fenster unter dem linken Block.
const fenster = { top: 275, bottom: 488, left: 12, right: 312, width: 300, height: 213 };
const video = { width: 298, height: 168 };
const rand = 12;

describe('livebildMaxBreite (LLH-2137)', () => {
  it('lässt das Fenster ungebremst, wenn es über dem Fuß Platz hat', () => {
    const breite = livebildMaxBreite({
      fenster,
      video,
      kartenUnten: 535,
      leisten: [{ top: 500, bottom: 523, left: 12, right: 290 }],
      rand,
    });
    // Platz für ein Bild von 500 − 12 − 275 − 45 = 168 px Höhe: genau das jetzige.
    expect(breite).toBeCloseTo(2 + (168 * 16) / 9, 5);
  });

  it('macht das Fenster schmaler, bis das Bild über dem obersten Band des Fußes endet', () => {
    const breite = livebildMaxBreite({
      fenster,
      video,
      kartenUnten: 535,
      leisten: [
        { top: 500, bottom: 523, left: 12, right: 290 },
        { top: 450, bottom: 490, left: 12, right: 200 },
      ],
      rand,
    });
    const hoehe = 450 - rand - fenster.top - (fenster.height - video.height);
    expect(breite).toBeCloseTo(fenster.width - video.width + (hoehe * 16) / 9, 5);
  });

  it('endet ohne Fuß am unteren Kartenrand', () => {
    const breite = livebildMaxBreite({ fenster, video, kartenUnten: 480, leisten: [], rand });
    const hoehe = 480 - rand - 275 - 45;
    expect(breite).toBeCloseTo(2 + (hoehe * 16) / 9, 5);
  });

  it('übergeht Leisten über der Oberkante des Fensters (Werkzeugmenü oben im Fuß), daneben und ohne Fläche', () => {
    const breite = livebildMaxBreite({
      fenster,
      video,
      kartenUnten: 535,
      leisten: [
        { top: 187, bottom: 400, left: 12, right: 290 },
        { top: 300, bottom: 340, left: 320, right: 380 },
        { top: 300, bottom: 300, left: 12, right: 290 },
      ],
      rand,
    });
    const hoehe = 535 - rand - 275 - 45;
    expect(breite).toBeCloseTo(2 + (hoehe * 16) / 9, 5);
  });

  it('schrumpft das Bild nie unter die Mindesthöhe', () => {
    const breite = livebildMaxBreite({ fenster, video, kartenUnten: 300, leisten: [], rand });
    expect(breite).toBeCloseTo(2 + (LIVEBILD_MIN_HOEHE * 16) / 9, 5);
  });
});
