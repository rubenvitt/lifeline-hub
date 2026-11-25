import { describe, expect, it } from 'vitest';
import { DROHNEN_PFEIL_KANTE_PX, drohnenPfeilBild } from './drohnenSymbol';

describe('Fluggerät-Pfeil (LLH-2106)', () => {
  const bild = drohnenPfeilBild();
  const pixel = (x: number, y: number) => {
    const i = (y * bild.width + x) * 4;
    return [...bild.data.slice(i, i + 4)];
  };

  it('hat die Größe seiner Pixeldaten und die Dichte, die addImage braucht', () => {
    expect(bild.width).toBe(DROHNEN_PFEIL_KANTE_PX * bild.pixelRatio);
    expect(bild.height).toBe(bild.width);
    expect(bild.data.length).toBe(bild.width * bild.height * 4);
  });

  it('ist innen weiß, am Rand schwarz und außen durchsichtig', () => {
    const mitte = bild.width / 2;
    // Auf der Achse unterhalb der Spitze liegt weiße Füllung.
    expect(pixel(mitte, Math.round(bild.height * 0.5))).toEqual([255, 255, 255, 255]);
    // Ecke des Bilds: nichts.
    expect(pixel(0, 0)[3]).toBe(0);
    const farben = new Set<string>();
    for (let i = 0; i < bild.data.length; i += 4) {
      if (bild.data[i + 3] === 255) farben.add(`${bild.data[i]},${bild.data[i + 1]}`);
    }
    // Nur Weiß und Schwarz: die Kante hält Kontrast gegen die Ebenenfarbe darunter.
    expect([...farben].sort()).toEqual(['0,0', '255,255']);
  });

  it('zeigt mit der Spitze nach oben', () => {
    const zeilenMitInhalt = (von: number, bis: number) => {
      let n = 0;
      for (let y = von; y < bis; y++)
        for (let x = 0; x < bild.width; x++) if (pixel(x, y)[3] > 0) n++;
      return n;
    };
    const h = bild.height;
    expect(zeilenMitInhalt(0, h / 2)).toBeLessThan(zeilenMitInhalt(h / 2, h));
  });
});
