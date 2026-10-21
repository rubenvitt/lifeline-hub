import { describe, expect, it, vi } from 'vitest';
import { meterJePixel, nimmKartenbildAuf, type AufnahmeKarte } from './kartenAufnahme';

/** Nachgebildete Karte: x-Pixel × `mJePx` Meter, `toBlob` liefert `bild`. */
function karte(
  bild: Blob | null,
  { mJePx = 2, peilung = 0, wirft = false } = {},
): AufnahmeKarte & { renderHandler: (() => void) | null; toBlob: ReturnType<typeof vi.fn> } {
  const toBlob = vi.fn((cb: (b: Blob | null) => void) => {
    if (wirft) throw new DOMException('verunreinigt', 'SecurityError');
    cb(bild);
  });
  const k = {
    renderHandler: null as (() => void) | null,
    toBlob,
    once(_e: 'render', h: () => void) {
      k.renderHandler = h;
    },
    triggerRepaint: vi.fn(() => k.renderHandler?.()),
    getCanvas: () => ({ width: 1600, height: 1000, toBlob }) as unknown as HTMLCanvasElement,
    getContainer: () => ({ clientWidth: 800, clientHeight: 500 }) as HTMLElement,
    getBearing: () => peilung,
    unproject: ([x]: [number, number]) => ({
      distanceTo: (o: unknown) => Math.abs((o as { x: number }).x - x) * mJePx,
      x,
    }),
  };
  return k;
}

describe('nimmKartenbildAuf', () => {
  it('nimmt im Render-Handler auf, nachdem ein Frame angefordert ist, samt Bündeln im Ausschnitt', async () => {
    const bild = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const k = karte(bild, { mJePx: 3, peilung: 15 });
    const imBild = {
      x: 10,
      y: 10,
      durchmesser: 40,
      ring: 6,
      segmente: [],
      neutral: '#999',
      zahl: '3',
      kurz: null,
    };
    const aussen = { ...imBild, x: 900 };
    const aufnahme = await nimmKartenbildAuf(k, () => [imBild, aussen]);
    expect(k.triggerRepaint).toHaveBeenCalledTimes(1);
    expect(k.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(aufnahme).toEqual({
      bild,
      breitePx: 1600,
      hoehePx: 1000,
      cssBreite: 800,
      cssHoehe: 500,
      meterJePx: 3,
      peilung: 15,
      buendel: [imBild],
    });
  });

  it('meldet null bei leerer oder verunreinigter Leinwand', async () => {
    expect(await nimmKartenbildAuf(karte(null))).toBeNull();
    expect(await nimmKartenbildAuf(karte(new Blob([])))).toBeNull();
    expect(
      await nimmKartenbildAuf(karte(new Blob([new Uint8Array([1])]), { wirft: true })),
    ).toBeNull();
  });
});

describe('meterJePixel', () => {
  it('misst quer durch die Mitte, ohne Platz keine Angabe', () => {
    expect(meterJePixel(karte(null, { mJePx: 4 }), 800, 500)).toBe(4);
    expect(meterJePixel(karte(null), 80, 500)).toBeNull();
  });
});
