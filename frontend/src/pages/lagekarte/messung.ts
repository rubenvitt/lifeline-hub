import {
  abstandM,
  formatFlaeche,
  formatLaenge,
  lineLaengeM,
  polygonFlaecheM2,
  polygonUmfangM,
} from './geo';

/**
 * Messwerkzeug der Lagekarte: Strecke, Fläche oder Radius (LLH-1043). Rein, ohne terra-draw — gerechnet wird mit
 * denselben Funktionen, aus denen der Inspector die Kennzahlen liest (`geo.ts`); zwei Rechenwege
 * wären der Fehlerfall.
 */
export type MessForm = 'strecke' | 'flaeche' | 'radius';

interface MessErgebnis {
  /** Der Messwert, formatiert; „—", solange zu wenige Punkte gesetzt sind. */
  haupt: string;
  /** Zusatz: bei der Fläche der Umfang, beim Radius die Kreisfläche. */
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

/** Die ersten `n` verschiedenen Punkte in ihrer Reihenfolge. */
function ersteVerschiedene(punkte: number[][], n: number): number[][] {
  const gesehen = new Set<string>();
  const out: number[][] = [];
  for (const p of punkte) {
    const k = `${p[0]}:${p[1]}`;
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    out.push(p);
    if (out.length === n) break;
  }
  return out;
}

export function messErgebnis(form: MessForm, g: MessGeometrie | null): MessErgebnis {
  if (!g) return OHNE;
  if (form === 'strecke') {
    if (g.type !== 'LineString') return OHNE;
    const punkte = g.coordinates as number[][];
    if (verschiedene(punkte) < 2) return OHNE;
    return { haupt: formatLaenge(lineLaengeM({ type: 'LineString', coordinates: punkte })) };
  }
  if (form === 'radius') {
    // Mitte und Rand sind die ersten beiden verschiedenen Punkte des Linienzugs; was danach
    // kommt (Vorschaupunkt nach dem zweiten Klick), ändert den Radius nicht mehr.
    if (g.type !== 'LineString') return OHNE;
    const [mitte, rand] = ersteVerschiedene(g.coordinates as number[][], 2);
    if (!rand) return OHNE;
    const r = abstandM({ lon: mitte[0], lat: mitte[1] }, { lon: rand[0], lat: rand[1] });
    return { haupt: `r = ${formatLaenge(r)}`, neben: `Fläche ${formatFlaeche(Math.PI * r * r)}` };
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
