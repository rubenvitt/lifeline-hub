import { formatFlaeche, formatLaenge, lineLaengeM, polygonFlaecheM2, polygonUmfangM } from './geo';

/**
 * Messwerkzeug der Lagekarte: Strecke oder Fläche. Rein, ohne terra-draw — gerechnet wird mit
 * denselben Funktionen, aus denen der Inspector die Kennzahlen liest (`geo.ts`); zwei Rechenwege
 * wären der Fehlerfall.
 */
export type MessForm = 'strecke' | 'flaeche';

interface MessErgebnis {
  /** Der Messwert, formatiert; „—", solange zu wenige Punkte gesetzt sind. */
  haupt: string;
  /** Zusatz, nur bei der Fläche: der Umfang. */
  neben?: string;
}

/** Lose Geometrie, wie terra-draw sie im Snapshot führt. */
export interface MessGeometrie {
  type: string;
  coordinates: unknown;
}

const OHNE: MessErgebnis = { haupt: '—' };

/** Zahl verschiedener Punkte — terra-draw wiederholt im Entwurf Punkte und schließt den Ring. */
function verschiedene(punkte: number[][]): number {
  return new Set(punkte.map(([lon, lat]) => `${lon}:${lat}`)).size;
}

export function messErgebnis(form: MessForm, g: MessGeometrie | null): MessErgebnis {
  if (!g) return OHNE;
  if (form === 'strecke') {
    if (g.type !== 'LineString') return OHNE;
    const punkte = g.coordinates as number[][];
    if (verschiedene(punkte) < 2) return OHNE;
    return { haupt: formatLaenge(lineLaengeM({ type: 'LineString', coordinates: punkte })) };
  }
  if (g.type !== 'Polygon') return OHNE;
  const ringe = g.coordinates as number[][][];
  if (!ringe[0] || verschiedene(ringe[0]) < 3) return OHNE;
  const poly = { type: 'Polygon' as const, coordinates: ringe };
  return {
    haupt: formatFlaeche(polygonFlaecheM2(poly)),
    neben: `Umfang ${formatLaenge(polygonUmfangM(poly))}`,
  };
}
