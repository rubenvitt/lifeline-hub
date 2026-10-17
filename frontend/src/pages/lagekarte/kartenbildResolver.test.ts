import { describe, expect, it, vi } from 'vitest';
import { kartenbildResolver, type KartenbildZiel } from './kartenbildResolver';
import type { Drawing } from '@einsatzzeichen/schema';
import { plakettenBildId } from './plakette';
import { GEPLANT_RING_BILD, geplantRingBild } from './geplantRing';

/** Kleinste Karte: hält Bilder und merkt sich, wer was angelegt hat. */
function fakeKarte(): KartenbildZiel & {
  bilder: Map<string, unknown>;
  optionen: Map<string, unknown>;
} {
  const bilder = new Map<string, unknown>();
  const optionen = new Map<string, unknown>();
  return {
    bilder,
    optionen,
    hasImage: (id) => bilder.has(id),
    addImage: (id, bild, opt) => {
      if (bilder.has(id)) throw new Error(`image ${id} already exists`);
      bilder.set(id, bild);
      optionen.set(id, opt);
    },
  };
}

const EZ_ID = 'ez|{"v":1,"spec":{"kind":"event"}}';

function aufbau(zeichen: Map<string, Drawing> = new Map()) {
  const karte = fakeKarte();
  const zeichneEz = vi.fn();
  const resolver = kartenbildResolver(karte, { zeichen: () => zeichen, zeichneEz });
  return { karte, zeichneEz, resolver };
}

describe('kartenbildResolver — gestrichelter Ring (LLH-1107)', () => {
  it('legt den Ring eines geplanten Raums synchron an, in doppelter Dichte', () => {
    const { karte, resolver, zeichneEz } = aufbau();
    resolver(GEPLANT_RING_BILD);
    expect(karte.hasImage(GEPLANT_RING_BILD)).toBe(true);
    const b = geplantRingBild();
    expect(karte.bilder.get(GEPLANT_RING_BILD)).toMatchObject({
      width: b.width,
      height: b.height,
    });
    expect(karte.optionen.get(GEPLANT_RING_BILD)).toEqual({ pixelRatio: 2 });
    expect(zeichneEz).not.toHaveBeenCalled();
    // Nach einem Stilwechsel fragt die Karte erneut — ein schon vorhandenes Bild bleibt.
    expect(() => resolver(GEPLANT_RING_BILD)).not.toThrow();
  });
});

// LFH-841: MapLibre 6 baut die Bildantwort einer Kachel, BEVOR es `styleimagemissing` feuert; nur
// was der Resolver anlegt (bzw. dessen Promise), steht im laufenden Layout.
describe('kartenbildResolver — Plakette', () => {
  const id = plakettenBildId({ grund: '#0a0c0e', rahmen: '#2e343a' });

  it('legt die Plakette synchron an, mit 9-Slice-Dehnung', () => {
    const { karte, resolver } = aufbau();
    const rueckgabe = resolver(id);
    // Synchron: schon vor jedem `await` vorhanden.
    expect(rueckgabe).toBeUndefined();
    expect(karte.hasImage(id)).toBe(true);
    expect(karte.bilder.get(id)).toMatchObject({ width: 8, height: 8 });
    expect(karte.optionen.get(id)).toEqual({
      stretchX: [[1, 7]],
      stretchY: [[1, 7]],
      content: [1, 1, 7, 7],
    });
  });

  it('legt eine vorhandene Plakette nicht doppelt an', () => {
    const { karte, resolver } = aufbau();
    resolver(id);
    expect(() => resolver(id)).not.toThrow();
    expect(karte.bilder.size).toBe(1);
  });

  it('übergeht eine unlesbare Plakette, ohne zu werfen', () => {
    const { karte, resolver } = aufbau();
    expect(() => resolver('plakette|kaputt|#zz')).not.toThrow();
    expect(karte.bilder.size).toBe(0);
  });
});

describe('kartenbildResolver — Zeichen (ez|, Fachobjekte und freie Zeichen)', () => {
  it('zeichnet über zeichneEz, wenn die Registry die Quelle kennt', () => {
    const drawing = { art: 'drawing' } as never;
    const { zeichneEz, resolver } = aufbau(new Map([[EZ_ID, drawing]]));
    expect(resolver(EZ_ID)).toBeUndefined();
    expect(zeichneEz).toHaveBeenCalledWith(EZ_ID, drawing);
  });

  it('fängt einen Fehler beim Zeichnen ab', () => {
    const { zeichneEz, resolver } = aufbau(new Map([[EZ_ID, {} as never]]));
    zeichneEz.mockImplementation(() => {
      throw new Error('kaputt');
    });
    expect(() => resolver(EZ_ID)).not.toThrow();
  });

  it('übergeht eine unbekannte Kennung', () => {
    const { zeichneEz, resolver } = aufbau();
    resolver(EZ_ID);
    expect(zeichneEz).not.toHaveBeenCalled();
  });
});

describe('kartenbildResolver — fremde Kennungen', () => {
  it('lässt sie liegen', () => {
    const { karte, zeichneEz, resolver } = aufbau();
    expect(resolver('fremd|x')).toBeUndefined();
    expect(karte.bilder.size).toBe(0);
    expect(zeichneEz).not.toHaveBeenCalled();
  });

  it('kennt keinen tz|-Weg mehr (LFH-836): ein Altschlüssel bleibt ohne Bild', () => {
    const { karte, zeichneEz, resolver } = aufbau(new Map([['tz|anlass||||||', {} as never]]));
    expect(resolver('tz|anlass||||||')).toBeUndefined();
    expect(karte.bilder.size).toBe(0);
    expect(zeichneEz).not.toHaveBeenCalled();
  });
});
