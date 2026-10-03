import { describe, expect, it, vi } from 'vitest';
import { kartenbildResolver, type KartenbildZiel } from './kartenbildResolver';
import type { ZeichenQuelle } from './markerIcons';
import { plakettenBildId } from './plakette';

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

const TZ_ID = 'tz|anlass||||||';
const EZ_ID = 'ez|{"v":1,"spec":{"kind":"event"}}';

function aufbau(zeichen: Map<string, ZeichenQuelle> = new Map()) {
  const karte = fakeKarte();
  const zeichneEz = vi.fn();
  const ladeTz = vi.fn(() =>
    Promise.resolve({ bild: { tz: true } as unknown as HTMLImageElement, pixelRatio: 2 }),
  );
  const resolver = kartenbildResolver(karte, { zeichen: () => zeichen, zeichneEz, ladeTz });
  return { karte, zeichneEz, ladeTz, resolver };
}

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

describe('kartenbildResolver — Fachobjekt-Zeichen (ez|)', () => {
  it('zeichnet über zeichneEz, wenn die Registry die Quelle kennt', () => {
    const drawing = { art: 'drawing' } as never;
    const { zeichneEz, resolver } = aufbau(new Map([[EZ_ID, { art: 'ez', drawing }]]));
    expect(resolver(EZ_ID)).toBeUndefined();
    expect(zeichneEz).toHaveBeenCalledWith(EZ_ID, drawing);
  });

  it('fängt einen Fehler beim Zeichnen ab', () => {
    const { zeichneEz, resolver } = aufbau(new Map([[EZ_ID, { art: 'ez', drawing: {} as never }]]));
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

describe('kartenbildResolver — freie Zeichen (tz|)', () => {
  const quelle: ZeichenQuelle = { art: 'tz', tz: { grundzeichen: 'anlass' } };

  it('liefert ein Promise und legt das Bild an, bevor es sich erfüllt', async () => {
    const { karte, ladeTz, resolver } = aufbau(new Map([[TZ_ID, quelle]]));
    const warten = resolver(TZ_ID);
    expect(warten).toBeInstanceOf(Promise);
    await warten;
    expect(ladeTz).toHaveBeenCalledWith(quelle.tz);
    expect(karte.hasImage(TZ_ID)).toBe(true);
    expect(karte.optionen.get(TZ_ID)).toEqual({ pixelRatio: 2 });
  });

  it('lädt ein Zeichen, nach dem zwei Kacheln gleichzeitig fragen, nur einmal', async () => {
    const { karte, ladeTz, resolver } = aufbau(new Map([[TZ_ID, quelle]]));
    await Promise.all([resolver(TZ_ID), resolver(TZ_ID)]);
    expect(ladeTz).toHaveBeenCalledTimes(1);
    expect(karte.bilder.size).toBe(1);
  });

  it('erfüllt sich auch bei gescheitertem Laden und versucht es beim nächsten Mal neu', async () => {
    const { karte, ladeTz, resolver } = aufbau(new Map([[TZ_ID, quelle]]));
    ladeTz.mockImplementationOnce(() => Promise.reject(new Error('onerror')));
    await expect(resolver(TZ_ID)).resolves.toBeUndefined();
    expect(karte.hasImage(TZ_ID)).toBe(false);
    await resolver(TZ_ID);
    expect(ladeTz).toHaveBeenCalledTimes(2);
    expect(karte.hasImage(TZ_ID)).toBe(true);
  });

  it('fängt einen synchronen Wurf des Altpakets ab', () => {
    const { ladeTz, resolver } = aufbau(new Map([[TZ_ID, quelle]]));
    ladeTz.mockImplementationOnce(() => {
      throw new Error('nicht DV-102-konform');
    });
    expect(() => resolver(TZ_ID)).not.toThrow();
  });

  it('übergeht eine Karte, die beim Eintreffen schon abgebaut ist', async () => {
    const { karte, resolver } = aufbau(new Map([[TZ_ID, quelle]]));
    karte.addImage = () => {
      throw new Error('style is null');
    };
    await expect(resolver(TZ_ID)).resolves.toBeUndefined();
  });
});

describe('kartenbildResolver — fremde Kennungen', () => {
  it('lässt sie liegen', () => {
    const { karte, zeichneEz, ladeTz, resolver } = aufbau();
    expect(resolver('fremd|x')).toBeUndefined();
    expect(karte.bilder.size).toBe(0);
    expect(zeichneEz).not.toHaveBeenCalled();
    expect(ladeTz).not.toHaveBeenCalled();
  });
});
