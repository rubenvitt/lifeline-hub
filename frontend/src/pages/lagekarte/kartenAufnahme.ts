/**
 * Bild des aktuellen Kartenausschnitts (LLH-1051, Spec `lagekarte-druck`) — ohne dauerhaftes
 * `preserveDrawingBuffer`, das auf Feldgeräten jeden Frame kostete.
 *
 * WebGL leert den Zeichenpuffer, sobald der Browser das Bild zusammensetzt. Im `render`-Ereignis
 * steht der eben gezeichnete Frame noch im Puffer; `toBlob` kopiert die Leinwand beim Aufruf (das
 * Kodieren läuft danach). Deshalb: `once('render')` anmelden, einen Frame anfordern, im Handler
 * aufnehmen. Gewartet wird nicht auf Kacheln: was fehlt, bleibt leere Fläche, nie ein Fehler.
 *
 * Basemap, Bild-Hintergründe, Zonen, Marker und Fachebenen sind Teil derselben Leinwand; DOM über
 * der Karte (Knöpfe, Bänder) ist es nicht und gehört auch nicht aufs Bild. Einzige Ausnahme sind
 * die Bündel-Donuts der Marker (DOM-Marker): ohne sie fehlten gebündelte Objekte. Ihre Lage und
 * ihr Bild nimmt die Aufnahme im selben Frame mit, `lageplanBild.ts` zeichnet sie auf.
 */

import type { DonutBild } from './clusterDonut';

/** Ein Bündel-Donut im Ausschnitt, Mittelpunkt in CSS-Pixeln. */
export interface KartenBuendel extends DonutBild {
  x: number;
  y: number;
}

export interface KartenAufnahme {
  bild: Blob;
  /** Größe der Leinwand in Gerätepixeln (das PNG). */
  breitePx: number;
  hoehePx: number;
  /** Größe des Ausschnitts in CSS-Pixeln (Grundlage des Maßstabs). */
  cssBreite: number;
  cssHoehe: number;
  /** Meter je CSS-Pixel quer durch die Bildmitte; `null`, wenn die Karte keinen liefert. */
  meterJePx: number | null;
  /** Drehung der Karte in Grad (0 = Norden oben). */
  peilung: number;
  /** Bündel-Donuts im Ausschnitt (DOM, nicht auf der Leinwand). */
  buendel: KartenBuendel[];
}

/** Was die Aufnahme von der maplibre-Karte braucht — nachgebildet im Test. */
export interface AufnahmeKarte {
  once(ereignis: 'render', handler: () => void): unknown;
  triggerRepaint(): void;
  getCanvas(): HTMLCanvasElement;
  getContainer(): HTMLElement;
  getBearing(): number;
  unproject(punkt: [number, number]): { distanceTo(anderer: unknown): number };
}

/** Halbe Messstrecke in CSS-Pixeln für den Maßstab (wie MapLibres `ScaleControl` quer gemessen). */
const MESS_HALB_PX = 50;

/** Meter je CSS-Pixel waagerecht durch die Mitte des Ausschnitts. */
export function meterJePixel(karte: AufnahmeKarte, breite: number, hoehe: number): number | null {
  if (!(breite > 2 * MESS_HALB_PX) || !(hoehe > 0)) return null;
  const y = hoehe / 2;
  const x = breite / 2;
  try {
    const links = karte.unproject([x - MESS_HALB_PX, y]);
    const rechts = karte.unproject([x + MESS_HALB_PX, y]);
    const m = links.distanceTo(rechts) / (2 * MESS_HALB_PX);
    return Number.isFinite(m) && m > 0 ? m : null;
  } catch {
    return null;
  }
}

/**
 * Nimmt den nächsten Frame der Karte als PNG auf. `null`, wenn die Leinwand kein Bild hergibt
 * (leer, ohne Kontext, verunreinigt durch fremde Kacheln ohne CORS).
 */
export function nimmKartenbildAuf(
  karte: AufnahmeKarte,
  buendelImFrame: () => KartenBuendel[] = () => [],
): Promise<KartenAufnahme | null> {
  return new Promise((fertig) => {
    karte.once('render', () => {
      const leinwand = karte.getCanvas();
      const container = karte.getContainer();
      const cssBreite = container.clientWidth;
      const cssHoehe = container.clientHeight;
      const meterJePx = meterJePixel(karte, cssBreite, cssHoehe);
      const peilung = karte.getBearing();
      const buendel = buendelImFrame().filter(
        (b) => b.x >= 0 && b.y >= 0 && b.x <= cssBreite && b.y <= cssHoehe,
      );
      try {
        leinwand.toBlob((bild) => {
          if (!bild || bild.size === 0 || leinwand.width === 0 || leinwand.height === 0) {
            fertig(null);
            return;
          }
          fertig({
            bild,
            breitePx: leinwand.width,
            hoehePx: leinwand.height,
            cssBreite,
            cssHoehe,
            meterJePx,
            peilung,
            buendel,
          });
        }, 'image/png');
      } catch {
        // SecurityError: eine verunreinigte Leinwand gibt kein Bild her.
        fertig(null);
      }
    });
    karte.triggerRepaint();
  });
}
