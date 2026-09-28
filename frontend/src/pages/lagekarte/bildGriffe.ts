/**
 * Aussehen und Auswahl der Bild-Ziehgriffe. Ohne `maplibre-gl`-Import, damit die Zusicherungen ohne
 * Karte prüfbar sind (`bildHandles.ts` braucht eine echte Map).
 */

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

/** Hinweis unter dem Umschalter: nennt nur die Griffe, die gerade scharf sind. */
export function griffHinweis(modus: GriffModus): string {
  switch (modus) {
    case 'verschieben':
      return 'Auf der Karte: Mitte ziehen zum Verschieben.';
    case 'drehen':
      return 'Auf der Karte: ↻ ziehen zum Drehen.';
    case 'groesse':
      return 'Auf der Karte: Ecken = Größe (Seitenverhältnis), Kanten = frei strecken.';
  }
}
