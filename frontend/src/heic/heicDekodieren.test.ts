import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dekodiereHeicPixel, HeicZuGross, zielmasse, type Libheif } from './heicDekodieren';

/**
 * Der Dekodierkern des HEIC-Workers (LFH-759) mit dem echten libheif-WASM in Node. Dekodiert
 * wird die bereinigte Fassung, die der Server ausliefert (Golden-Fixture, festgenagelt in
 * `tests/anhang_vorschau.rs`): 64 × 48 quer kodiert, links rot, über `irot` hochkant.
 */
// jsdom setzt `import.meta.url` auf http://; Pfade deshalb ab dem Frontend-Ordner (cwd der Suite).
const require = createRequire(join(process.cwd(), 'package.json'));

async function ladeLibheif(): Promise<Libheif> {
  const fabrik = require('libheif-js/libheif-wasm/libheif.js') as (o: object) => Libheif;
  const wasmBinary = readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm'));
  // Emscripten füllt das übergebene Objekt selbst zum Modul aus; der Rückruf kann noch während
  // des Aufrufs kommen.
  return new Promise((fertig) => {
    const modul: Record<string, unknown> = { wasmBinary };
    modul.onRuntimeInitialized = () => fertig(modul as unknown as Libheif);
    fabrik(modul);
  });
}

const BEREINIGT = new Uint8Array(
  readFileSync(join(process.cwd(), 'src/heic/__fixtures__/hochkant.bereinigt.heic')),
);

function pixel(bild: { breite: number; daten: Uint8ClampedArray }, x: number, y: number) {
  const i = (y * bild.breite + x) * 4;
  return Array.from(bild.daten.slice(i, i + 3));
}

const nah = (ist: number[], soll: number[]) => ist.every((v, i) => Math.abs(v - soll[i]!) < 40);

describe('dekodiereHeicPixel (LFH-759)', () => {
  it('dekodiert die bereinigte Fassung mit angewendeter Drehung', async () => {
    const libheif = await ladeLibheif();
    const bild = await dekodiereHeicPixel(BEREINIGT, libheif);
    expect([bild.breite, bild.hoehe]).toEqual([48, 64]);
    expect(bild.daten).toHaveLength(48 * 64 * 4);
    // Die linke (rote) Hälfte des quer kodierten Bildes steht nach der Drehung oben.
    expect(nah(pixel(bild, 24, 5), [220, 20, 20])).toBe(true);
    expect(nah(pixel(bild, 24, 58), [20, 20, 220])).toBe(true);
  });

  it('weist kaputte Daten ab', async () => {
    const libheif = await ladeLibheif();
    await expect(dekodiereHeicPixel(BEREINIGT.slice(0, 200), libheif)).rejects.toThrow();
  });

  it('weist mehr als 50 Millionen Bildpunkte vor dem Dekodieren ab', async () => {
    const riesig = {
      HeifDecoder: class {
        decode() {
          return [
            {
              is_primary: () => true,
              get_width: () => 10_000,
              get_height: () => 6_000,
              display: () => {
                throw new Error('darf nicht dekodieren');
              },
              free: () => undefined,
            },
          ];
        }
      },
    } as unknown as Libheif;
    await expect(dekodiereHeicPixel(BEREINIGT, riesig)).rejects.toBeInstanceOf(HeicZuGross);
  });
});

describe('zielmasse (LFH-759)', () => {
  it('passt die längste Kante ein und vergrößert nie', () => {
    expect(zielmasse(4032, 3024, 256)).toEqual([256, 192]);
    expect(zielmasse(3024, 4032, 1600)).toEqual([1200, 1600]);
    expect(zielmasse(48, 64, 256)).toEqual([48, 64]);
  });
});
