/**
 * Dekodierkern für HEIC/HEIF (LFH-759, Spec `anhang-vorschau`, „HEIC-Vorschau auf dem Gerät“).
 * Läuft im Worker (`heicWorker.ts`) und in den Tests unter Node, deshalb ohne DOM und ohne
 * Canvas: er liefert nur RGBA-Bildpunkte.
 *
 * libheif wendet die Transformationen des Containers (`irot`, `imir`) beim Dekodieren an; die
 * gelieferten Maße sind die der Anzeige.
 */

/** Höchstzahl an Bildpunkten, wie beim Server (`src/anhang/vorschau/`, `MAX_BILDPUNKTE`). */
export const MAX_BILDPUNKTE = 50_000_000;

/** Ein Bild aus `HeifDecoder.decode` (Ausschnitt der API von `libheif-js`). */
interface HeifBild {
  is_primary(): boolean;
  get_width(): number;
  get_height(): number;
  display(
    ziel: { data: Uint8ClampedArray; width: number; height: number },
    fertig: (ergebnis: unknown) => void,
  ): void;
  free(): void;
}

/** Ein Decoder; `decoder` ist sein libheif-Kontext, den nur das nächste `decode` freigäbe. */
interface HeifDecoder {
  decode(daten: Uint8Array): HeifBild[];
  decoder: unknown;
}

/** Das geladene libheif-Modul (Ausschnitt). */
export interface Libheif {
  HeifDecoder: new () => HeifDecoder;
  heif_context_free(kontext: unknown): void;
}

export interface HeicPixel {
  breite: number;
  hoehe: number;
  /** RGBA, Zeile für Zeile. */
  daten: Uint8ClampedArray;
}

/** Das Bild hat mehr Bildpunkte, als die Vorschau dekodiert. */
export class HeicZuGross extends Error {
  constructor() {
    super('HEIC-Bild zu groß für eine Vorschau');
    this.name = 'HeicZuGross';
  }
}

/** Dekodiert das Hauptbild von `daten` zu RGBA. Wirft bei kaputten Daten oder zu großen Bildern. */
export async function dekodiereHeicPixel(daten: Uint8Array, libheif: Libheif): Promise<HeicPixel> {
  const decoder = new libheif.HeifDecoder();
  const bilder = decoder.decode(daten);
  // libheif-js gibt den Kontext (samt Kopie der Datei) erst beim NÄCHSTEN `decode` desselben
  // Decoders frei; ohne dieses `free` wüchse der WASM-Speicher des Workers mit jedem Foto.
  const kontextFrei = () => {
    if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
    decoder.decoder = null;
  };
  if (bilder.length === 0) {
    kontextFrei();
    throw new Error('HEIC nicht lesbar');
  }
  const bild = bilder.find((b) => b.is_primary()) ?? bilder[0]!;
  try {
    const breite = bild.get_width();
    const hoehe = bild.get_height();
    if (breite <= 0 || hoehe <= 0) throw new Error('HEIC ohne Maße');
    if (breite * hoehe > MAX_BILDPUNKTE) throw new HeicZuGross();
    const ziel = { data: new Uint8ClampedArray(breite * hoehe * 4), width: breite, height: hoehe };
    await new Promise<void>((fertig, fehler) => {
      bild.display(ziel, (ergebnis) =>
        ergebnis ? fertig() : fehler(new Error('HEIC nicht dekodierbar')),
      );
    });
    return { breite, hoehe, daten: ziel.data };
  } finally {
    for (const b of bilder) b.free();
    kontextFrei();
  }
}

/**
 * Lädt etwas genau einmal, aber nicht für immer falsch: scheitert das Laden (etwa die WASM-Datei
 * ohne Netz), versucht es der nächste Aufruf neu.
 */
export function einmalLaden<T>(laden: () => Promise<T>): () => Promise<T> {
  let laufend: Promise<T> | null = null;
  return () => {
    laufend ??= laden().catch((fehler: unknown) => {
      laufend = null;
      throw fehler;
    });
    return laufend;
  };
}

/** Maße, mit denen die längste Kante in `kante` passt; nie vergrößert. */
export function zielmasse(breite: number, hoehe: number, kante: number): [number, number] {
  const faktor = Math.min(1, kante / Math.max(breite, hoehe));
  return [Math.max(1, Math.round(breite * faktor)), Math.max(1, Math.round(hoehe * faktor))];
}
