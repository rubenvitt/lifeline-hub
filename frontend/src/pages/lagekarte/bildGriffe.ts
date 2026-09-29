/**
 * Aussehen und Auswahl der Bild-Ziehgriffe. Ohne `maplibre-gl`-Import, damit die Zusicherungen ohne
 * Karte prüfbar sind (`bildHandles.ts` braucht eine echte Map).
 */
import type { Punkt } from './bildGeometrie';

/** Griffarten: Ecke (proportional), Kante (frei strecken), Drehung, Mitte (verschieben). */
export type GriffArt = 'eck' | 'kante' | 'dreh' | 'mitte';

/** Welche Griffsorte gerade scharf ist. */
export type GriffModus = 'verschieben' | 'groesse' | 'drehen';

/**
 * Boden der anfassbaren Fläche, unabhängig von der Dichtestufe (WCAG 2.5.5 / Apple HIG 44 pt): in
 * `kompakt` sind 30 px für einen Fingergriff auf einem Bild zu klein; darüber gilt die Staffel.
 */
export const GRIFF_BODEN = 44;

/** Kantenlänge des SICHTBAREN Kerns eines Eck-/Kantengriffs. */
export const GRIFF_KERN = 12;

/** Drehgriff sitzt diesen Pixel-Abstand über der oberen Bildkante. */
export const DREHGRIFF_ABSTAND_PX = 28;

/**
 * Was ein Griff aus dem Kontext braucht. Die Griffe hängen an `maplibregl.Marker`, also außerhalb
 * des `ConfigProvider` — Stufe und Rolle reicht `Kartenflaeche` aufgelöst herein.
 */
export interface GriffKontext {
  /** `token.controlHeight` der aktiven Dichtestufe (30 / 48 / 72). */
  controlHeight: number;
  /** Aufgelöste Rolle `bedien` des aktiven Modus — ein Griff ist Bedienung, kein Zustand. */
  bedien: string;
}

/** Kantenlänge der anfassbaren Fläche: die Staffel, aber nie unter {@link GRIFF_BODEN}. */
export function griffKante(controlHeight: number): number {
  return Math.max(controlHeight, GRIFF_BODEN);
}

/**
 * Container- und Kern-Stil eines Griffs: der Container ist groß und durchsichtig (das Ziel), der
 * Kern klein und farbig (wo der Punkt sitzt). Zeichenketten, weil die Griffe per `element` an einen
 * `maplibregl.Marker` gehen und dort als `cssText` gesetzt werden.
 */
export function griffStil(art: GriffArt, k: GriffKontext): { container: string; kern: string } {
  const kante = griffKante(k.controlHeight);
  const zeiger = art === 'dreh' ? 'grab' : art === 'mitte' ? 'move' : 'pointer';
  const container =
    `width:${kante}px;height:${kante}px;background:transparent;` +
    `display:flex;align-items:center;justify-content:center;cursor:${zeiger}`;

  if (art === 'dreh') {
    return {
      container,
      kern:
        `width:22px;height:22px;background:${k.bedien};border:2px solid #fff;border-radius:50%;` +
        'display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;' +
        'line-height:1;box-shadow:0 0 3px rgba(0,0,0,.5)',
    };
  }
  if (art === 'mitte') {
    return {
      container,
      kern:
        `width:16px;height:16px;background:${k.bedien};border:2px solid #fff;` +
        'border-radius:50%;box-shadow:0 0 3px rgba(0,0,0,.5)',
    };
  }
  // Eckgriff eckig, Kantengriff rund — der Formunterschied sagt, ob das Seitenverhältnis bleibt.
  const radius = art === 'eck' ? '2px' : '50%';
  return {
    container,
    kern:
      `width:${GRIFF_KERN}px;height:${GRIFF_KERN}px;background:#fff;border:2px solid ${k.bedien};` +
      `border-radius:${radius};box-shadow:0 0 2px rgba(0,0,0,.5)`,
  };
}

/**
 * Welche Griffe im jeweiligen Modus scharf sind. Zehn große Griffe lägen auf einem kleinen Bild
 * übereinander; die Partition ist echt — keine Art in zwei Modi, keine ohne.
 */
export function griffeFuerModus(modus: GriffModus): GriffArt[] {
  switch (modus) {
    case 'verschieben':
      return ['mitte'];
    case 'groesse':
      return ['eck', 'kante'];
    case 'drehen':
      return ['dreh'];
  }
}

type Vier<T> = [T, T, T, T];

/** Pixelpositionen aller Griffe: Ecken 0–3 und Kanten oben/rechts/unten/links wie in `bildHandles`. */
export interface GriffPunkte {
  eck: Vier<Punkt>;
  kante: Vier<Punkt>;
  dreh: Punkt;
  mitte: Punkt;
}

/** Wie viele Kantengriffe mangels Platz fehlen; außerhalb von „Größe" immer `keine`. */
export type KantenAus = 'keine' | 'einige' | 'alle';

/** Welche Griffe scharf sind, und ob Kanten mangels Platz fehlen ({@link KantenAus}). */
export interface GriffWahl {
  eck: Vier<boolean>;
  kante: Vier<boolean>;
  dreh: boolean;
  mitte: boolean;
  kantenAus: KantenAus;
}

/** Zwei Container (achsenparallele Quadrate der Kante `kante` um den Griffpunkt) überlappen. */
function ueberlappen(a: Punkt, b: Punkt, kante: number): boolean {
  return Math.abs(a[0] - b[0]) < kante && Math.abs(a[1] - b[1]) < kante;
}

/**
 * Welche Griffe scharf sind (LFH-764). Die Arten kommen aus {@link griffeFuerModus}; im Modus
 * „Größe" gilt zusätzlich: Ecken immer — ohne sie wäre ein winziges Bild nicht mehr skalierbar —,
 * eine Kante nur, wenn ihr Container weder eine Ecke noch eine ANDERE Kante überlappt. Symmetrisch
 * statt gierig: zwei sich überlappende Kanten fallen beide weg, sonst hinge die Wahl an der
 * Aufzählreihenfolge. Die Container drehen nicht mit dem Bild; `kante` ist {@link griffKante}.
 */
export function scharfeGriffe(modus: GriffModus, punkte: GriffPunkte, kante: number): GriffWahl {
  const arten = new Set(griffeFuerModus(modus));
  const kanteFrei = (i: number) =>
    punkte.eck.every((e) => !ueberlappen(punkte.kante[i], e, kante)) &&
    punkte.kante.every((k, j) => j === i || !ueberlappen(punkte.kante[i], k, kante));
  const eck = arten.has('eck');
  const kanten = [0, 1, 2, 3].map((i) => arten.has('kante') && kanteFrei(i)) as Vier<boolean>;
  const fehlend = arten.has('kante') ? kanten.filter((k) => !k).length : 0;
  return {
    eck: [eck, eck, eck, eck],
    kante: kanten,
    dreh: arten.has('dreh'),
    mitte: arten.has('mitte'),
    kantenAus: fehlend === 0 ? 'keine' : fehlend === 4 ? 'alle' : 'einige',
  };
}

/**
 * Hinweis unter dem Umschalter: nennt nur die Griffe, die gerade scharf sind. Fehlen im Modus
 * „Größe" Kanten ({@link scharfeGriffe}), sagt er das und nennt den Ausweg.
 */
export function griffHinweis(
  modus: GriffModus,
  stand: { kantenAus: KantenAus } = { kantenAus: 'keine' },
): string {
  switch (modus) {
    case 'verschieben':
      return 'Auf der Karte: Mitte ziehen zum Verschieben.';
    case 'drehen':
      return 'Auf der Karte: ↻ ziehen zum Drehen.';
    case 'groesse':
      switch (stand.kantenAus) {
        case 'keine':
          return 'Auf der Karte: Ecken = Größe (Seitenverhältnis), Kanten = frei strecken.';
        case 'einige':
          return 'Auf der Karte: Ecken = Größe (Seitenverhältnis), Kanten = frei strecken. Weitere Kanten erscheinen nach dem Heranzoomen.';
        case 'alle':
          return 'Auf der Karte: Ecken = Größe (Seitenverhältnis). Zum freien Strecken an den Kanten heranzoomen.';
      }
  }
}
