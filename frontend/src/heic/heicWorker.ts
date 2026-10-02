/// <reference lib="webworker" />
/**
 * Worker der HEIC-Vorschau (LFH-759, design.md D8): dekodiert mit libheif als WASM und
 * verkleinert per `OffscreenCanvas` auf die beiden Größen der Vorschau (256 / 1600 px, wie der
 * Server). Ein JPEG-Blob ist neu kodiert und trägt keine Metadaten.
 *
 * Die `libheif.wasm` liegt als eigene, unveränderte Datei im Bündel (`?url`), getrennt vom
 * App-Code; Lizenz und Herkunft: `LIESMICH.md` hier.
 */
import fabrik from 'libheif-js/libheif-wasm/libheif.js';
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';
import { dekodiereHeicPixel, einmalLaden, zielmasse, type Libheif } from './heicDekodieren';

const KANTE_KLEIN = 256;
const KANTE_GROSS = 1600;
const JPEG_QUALITAET = 0.8;

const ladeLibheif = einmalLaden(
  () =>
    new Promise<Libheif>((fertig, fehler) => {
      // Emscripten füllt das übergebene Objekt selbst zum Modul aus.
      const modul: Record<string, unknown> = {
        locateFile: () => wasmUrl,
        onRuntimeInitialized: () => fertig(modul as unknown as Libheif),
        onAbort: (grund: unknown) => fehler(new Error(`libheif: ${String(grund)}`)),
      };
      fabrik(modul);
    }),
);

/** Der Auftrag, der gerade dekodiert wird (der Client schickt einen nach dem anderen). */
let laufend: number | null = null;

// Ein Absturz im WASM (etwa Speicher erschöpft) kommt aus einem Timer von libheif-js als
// unbehandelte Ablehnung: weder als Antwort noch als `error` am Worker. Sie wird hier zur
// Fehlerantwort; `tot` lässt den Client den Worker ersetzen, denn das WASM ist danach unbrauchbar.
self.onunhandledrejection = (e: PromiseRejectionEvent) => {
  if (laufend == null) return;
  self.postMessage({ id: laufend, fehler: String(e.reason), tot: true });
  laufend = null;
};

async function verkleinere(quelle: OffscreenCanvas, kante: number): Promise<Blob> {
  const [breite, hoehe] = zielmasse(quelle.width, quelle.height, kante);
  const ziel = new OffscreenCanvas(breite, hoehe);
  const kontext = ziel.getContext('2d');
  if (!kontext) throw new Error('kein 2D-Kontext');
  kontext.imageSmoothingQuality = 'high';
  kontext.drawImage(quelle, 0, 0, breite, hoehe);
  return ziel.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITAET });
}

self.onmessage = async (e: MessageEvent<{ id: number; daten: ArrayBuffer }>) => {
  const { id, daten } = e.data;
  laufend = id;
  try {
    const bild = await dekodiereHeicPixel(new Uint8Array(daten), await ladeLibheif());
    const voll = new OffscreenCanvas(bild.breite, bild.hoehe);
    const kontext = voll.getContext('2d');
    if (!kontext) throw new Error('kein 2D-Kontext');
    kontext.putImageData(
      new ImageData(new Uint8ClampedArray(bild.daten), bild.breite, bild.hoehe),
      0,
      0,
    );
    const klein = await verkleinere(voll, KANTE_KLEIN);
    const gross = await verkleinere(voll, KANTE_GROSS);
    if (laufend === id) self.postMessage({ id, klein, gross });
  } catch (fehler) {
    if (laufend === id) {
      self.postMessage({ id, fehler: fehler instanceof Error ? fehler.message : String(fehler) });
    }
  } finally {
    if (laufend === id) laufend = null;
  }
};
