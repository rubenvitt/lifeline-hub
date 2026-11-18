/**
 * Platzierung der Kartenmarken des Lagemonitors (LLH-1933): die Marken sind DOM-Marker in
 * Großbild-Schrift, mittig an ihrem Punkt verankert. Ohne Rücksicht aufeinander deckte die Marke
 * eines Gefahrengebiets, dessen Schwerpunkt auf dem Einsatzort liegt, den Punkt zu, und Marken
 * nahe beieinander überdeckten sich.
 *
 * {@link placeMarken} rechnet im Bildschirmraum: Hindernisse (der Punkt des Einsatzorts) bleiben
 * frei, die Marken werden in der übergebenen Rangfolge gesetzt (UHS vor Abschnitten vor Zonen),
 * jede auf die erste Lage um ihren Anker, die weder ein Hindernis noch eine schon gesetzte Marke
 * berührt. Jede Lage wird in die Kachel geschoben, damit nichts abgeschnitten wird (Großbild-Regel,
 * `geraet/AGENTS.md`, Lagemonitor). Gibt es keine freie Lage, nimmt die Marke die mit der geringsten
 * Überdeckung; ausgeblendet wird nichts. Die Schrift bleibt unberührt.
 */

/** Ein Rechteck in Bildschirm-Pixeln der Kachel. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Eine zu setzende Marke: Anker in Pixeln der Kachel, Maße ihres Elements. */
export interface MarkenEingabe {
  anchor: { x: number; y: number };
  width: number;
  height: number;
}

/** Versatz der Markenmitte gegenüber ihrem Anker (maplibres `Marker.setOffset`). */
export interface MarkenVersatz {
  dx: number;
  dy: number;
}

/** Mindestabstand zwischen zwei Marken und zwischen Marke und Hindernis, in px. */
export const MARKEN_ABSTAND = 8;

/** Wie viele Ringe um den Anker probiert werden, bevor die geringste Überdeckung gilt. */
const RINGE = 6;

/** Richtungen je Ring, in Vorzugsreihenfolge: über, unter, rechts, links, dann schräg. */
const RICHTUNGEN: readonly [number, number][] = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
];

/** Ein Hindernis wiegt schwerer als eine Marke: lieber zwei Marken berühren als den Einsatzort. */
const HINDERNIS_GEWICHT = 10;

function overlapArea(a: Box, b: Box): number {
  const breite = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const hoehe = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return breite > 0 && hoehe > 0 ? breite * hoehe : 0;
}

/** Ein Rahmen, um den halben Mindestabstand nach allen Seiten erweitert. */
function inflate(b: Box): Box {
  const h = MARKEN_ABSTAND / 2;
  return { left: b.left - h, top: b.top - h, width: b.width + 2 * h, height: b.height + 2 * h };
}

/** Schiebt einen Versatz so, dass die Marke ganz in der Kachel liegt (passt sie nicht, links/oben). */
function clampIntoArea(
  m: MarkenEingabe,
  v: MarkenVersatz,
  area: { width: number; height: number },
): MarkenVersatz {
  const clamp = (mitte: number, mass: number, grenze: number) => {
    const min = mass / 2;
    const max = grenze - mass / 2;
    if (max < min) return min;
    return Math.min(Math.max(mitte, min), max);
  };
  const x = clamp(m.anchor.x + v.dx, m.width, area.width);
  const y = clamp(m.anchor.y + v.dy, m.height, area.height);
  return { dx: x - m.anchor.x, dy: y - m.anchor.y };
}

function candidates(m: MarkenEingabe): MarkenVersatz[] {
  const schrittX = (m.width + MARKEN_ABSTAND) / 2;
  const schrittY = (m.height + MARKEN_ABSTAND) / 2;
  const liste: MarkenVersatz[] = [{ dx: 0, dy: 0 }];
  for (let k = 1; k <= RINGE; k++) {
    for (const [rx, ry] of RICHTUNGEN) liste.push({ dx: rx * k * schrittX, dy: ry * k * schrittY });
  }
  return liste;
}

/**
 * Versatz je Marke, in der Reihenfolge von `marken` (zugleich die Rangfolge: frühere behalten ihren
 * Platz, spätere weichen aus). `obstacles` bleiben frei, soweit irgend möglich.
 */
export function placeMarken({
  area,
  obstacles,
  marken,
}: {
  area: { width: number; height: number };
  obstacles: readonly Box[];
  marken: readonly MarkenEingabe[];
}): MarkenVersatz[] {
  const hindernisse = obstacles.map(inflate);
  const gesetzt: Box[] = [];
  return marken.map((m) => {
    let beste: { versatz: MarkenVersatz; kosten: number; box: Box } | null = null;
    for (const roh of candidates(m)) {
      const versatz = clampIntoArea(m, roh, area);
      const box = inflate({
        left: m.anchor.x + versatz.dx - m.width / 2,
        top: m.anchor.y + versatz.dy - m.height / 2,
        width: m.width,
        height: m.height,
      });
      let kosten = 0;
      for (const h of hindernisse) kosten += HINDERNIS_GEWICHT * overlapArea(box, h);
      for (const g of gesetzt) kosten += overlapArea(box, g);
      if (!beste || kosten < beste.kosten) beste = { versatz, kosten, box };
      if (kosten === 0) break;
    }
    gesetzt.push(beste!.box);
    return beste!.versatz;
  });
}
