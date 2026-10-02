import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dekodiereHeicPixel,
  einmalLaden,
  HeicZuGross,
  zielmasse,
  type Libheif,
} from './heicDekodieren';
import { vi } from 'vitest';

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
      heif_context_free: () => undefined,
      HeifDecoder: class {
        decoder = 1;
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

describe('dekodiereHeicPixel — Speicher des Workers (LFH-759)', () => {
  it('gibt den libheif-Kontext nach jedem Bild frei, auch im Fehlerfall', async () => {
    const frei = vi.fn();
    const kontexte: object[] = [];
    const attrappe = (breite: number) =>
      ({
        heif_context_free: frei,
        HeifDecoder: class {
          decoder = { nr: kontexte.push({}) };
          decode() {
            return [
              {
                is_primary: () => true,
                get_width: () => breite,
                get_height: () => 1,
                display: (ziel: unknown, fertig: (e: unknown) => void) => fertig(ziel),
                free: () => undefined,
              },
            ];
          }
        },
      }) as unknown as Libheif;
    await dekodiereHeicPixel(BEREINIGT, attrappe(2));
    await expect(dekodiereHeicPixel(BEREINIGT, attrappe(60_000_000))).rejects.toBeInstanceOf(
      HeicZuGross,
    );
    expect(frei).toHaveBeenCalledTimes(2);
    expect(frei.mock.calls.map(([k]) => (k as { nr: number }).nr)).toEqual([1, 2]);
  });
});

describe('einmalLaden (LFH-759)', () => {
  it('lädt einmal und merkt sich das Ergebnis', async () => {
    const laden = vi.fn().mockResolvedValue('modul');
    const holen = einmalLaden(laden);
    expect(await holen()).toBe('modul');
    expect(await holen()).toBe('modul');
    expect(laden).toHaveBeenCalledTimes(1);
  });

  it('versucht es nach einem Fehlschlag beim nächsten Aufruf neu', async () => {
    const laden = vi.fn().mockRejectedValueOnce(new Error('ohne Netz')).mockResolvedValue('modul');
    const holen = einmalLaden(laden);
    await expect(holen()).rejects.toThrow('ohne Netz');
    expect(await holen()).toBe('modul');
    expect(laden).toHaveBeenCalledTimes(2);
  });
});
