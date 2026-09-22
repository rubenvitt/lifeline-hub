import { OFFLINE_GLYPHS } from './basemapStil';
import type { Farbrollen } from '../../theme/tokens';

/**
 * Beschriftung im Entwurfsstil (Neuentwurf S5): dunkle Plakette mit Rahmen `linieStark`,
 * Text in `text` — an Zonen und, seit LFH-622, an Markern. Die Werte sind AUFGELÖSTE Rollen:
 * MapLibre-`paint` kennt weder `var(--lfh-*)` noch antd-Token, deshalb reichen
 * `useLagekarteDaten` (Zonen) und `Kartenflaeche` (Marker) sie durch.
 */
export interface Plakette {
  text: string;
  grund: string;
  rahmen: string;
}

/** Plakette aus einem Rollensatz — rein, damit die Rollenwahl ohne Karte prüfbar ist. Der
 *  Name stammt aus der Zeit, als nur Zonen eine trugen; Marker nehmen dieselbe (LFH-622). */
export function zonenPlakette(
  rollen: Pick<Farbrollen, 'text' | 'paneel' | 'linieStark'>,
): Plakette {
  return { text: rollen.text, grund: rollen.paneel, rahmen: rollen.linieStark };
}

/** Präfix der Plakettenbilder; `styleimagemissing` in `Kartenflaeche.tsx` erkennt es daran. */
export const PLAKETTE_PRAEFIX = 'plakette|';

/** Bild-Id einer Plakette: die Farben stehen IN der Id, damit der Handler sie nach einem
 *  `setStyle` (der alle Bilder wegwischt) ohne weiteren Zustand neu zeichnen kann. */
export function plakettenBildId(p: Pick<Plakette, 'grund' | 'rahmen'>): string {
  return `${PLAKETTE_PRAEFIX}${p.grund}|${p.rahmen}`;
}

/** `#rrggbb` → [r, g, b]; alles andere → null (dann gibt es keine Plakette, nur Text). */
function hexZuRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Kantenlänge des Plakettenbilds; 1 px Rahmen, der Rest dehnbar (9-Slice). */
const PLAKETTE_KANTE = 8;

/**
 * Das Plakettenbild als Pixeldaten für `map.addImage` — ein 9-Slice aus 1 px Rahmen und
 * dehnbarem Innenraum, das `icon-text-fit` um den Text legt. Rein und exportiert: die
 * Karte selbst läuft in jsdom nicht, die Pixel schon. `null` für eine fremde oder
 * unlesbare Id — der Aufrufer legt dann kein Bild an, und die Beschriftung steht ohne
 * Plakette da, statt dass ein Fehler aus dem MapLibre-Callback fliegt.
 */
export function plakettenBild(id: string): {
  width: number;
  height: number;
  data: Uint8Array;
  stretchX: [number, number][];
  stretchY: [number, number][];
  content: [number, number, number, number];
} | null {
  if (!id.startsWith(PLAKETTE_PRAEFIX)) return null;
  const [grundHex, rahmenHex] = id.slice(PLAKETTE_PRAEFIX.length).split('|');
  const grund = hexZuRgb(grundHex ?? '');
  const rahmen = hexZuRgb(rahmenHex ?? '');
  if (!grund || !rahmen) return null;
  const k = PLAKETTE_KANTE;
  const data = new Uint8Array(k * k * 4);
  for (let y = 0; y < k; y++) {
    for (let x = 0; x < k; x++) {
      const rand = x === 0 || y === 0 || x === k - 1 || y === k - 1;
      const [r, g, b] = rand ? rahmen : grund;
      const i = (y * k + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      // Der Grund deckt nicht ganz (Entwurf: `rgba(12,14,17,.92)`), der Rahmen schon.
      data[i + 3] = rand ? 255 : 235;
    }
  }
  return {
    width: k,
    height: k,
    data,
    stretchX: [[1, k - 1]],
    stretchY: [[1, k - 1]],
    content: [1, 1, k - 1, k - 1],
  };
}

/**
 * Fontstack der eingebetteten Mono-Glyphs (`assets/karten/fonts/`, erzeugt von
 * `karten-build/gen-assets.sh`). Der Name muss byte-gleich zum Ordner sein — der Server
 * liefert pfadbasiert aus.
 */
export const PLAKETTEN_MONO = 'JetBrains Mono Regular';

type StilAusschnitt = {
  glyphs?: string;
  layers?: ReadonlyArray<{ layout?: unknown }>;
};

function schriftListe(wert: unknown): string[] | undefined {
  const istListe = (w: unknown): w is string[] =>
    Array.isArray(w) && w.length > 0 && w.every((x) => typeof x === 'string');
  if (Array.isArray(wert) && wert[0] === 'literal') return istListe(wert[1]) ? wert[1] : undefined;
  return istListe(wert) ? wert : undefined;
}

/**
 * Welche Schrift die Plaketten anfordern (LFH-622). Ein Fontstack, den der Glyphen-Server
 * des aktiven Stils nicht führt, lässt MapLibre Plakette UND Text STILL weglassen —
 * deshalb hängt die Wahl am Stil, nicht an einer Vorgabe:
 *
 * - **offline** → Mono, denn der eigene Server liefert sie aus;
 * - **online** → die erste literale Schrift des Anbieter-Stils: die führt dessen Server
 *   sicher, eine Mono-Familie dort nicht;
 * - **ohne Glyphen-Server** (Blindkarte) → keine Angabe, MapLibre zeichnet lokal.
 *
 * `undefined` heißt „kein `text-font` setzen". Das ist offline ausdrücklich NICHT richtig:
 * MapLibres Vorgabe ist „Open Sans Regular,Arial Unicode MS Regular", und die führt der
 * eigene Server nicht — ohne diese Funktion standen die Zonenplaketten offline leer.
 */
export function plakettenSchrift(stil: StilAusschnitt | undefined): string[] | undefined {
  if (!stil?.glyphs) return undefined;
  if (stil.glyphs === OFFLINE_GLYPHS) return [PLAKETTEN_MONO];
  for (const layer of stil.layers ?? []) {
    const layout = layer.layout as Record<string, unknown> | undefined;
    const schrift = schriftListe(layout?.['text-font']);
    if (schrift) return schrift;
  }
  return undefined;
}
