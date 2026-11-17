/**
 * Breite eines Texts über `canvas.measureText`, rein bis auf die Leinwand (LLH-1788, LLH-1789).
 * Gerechnet statt am DOM gemessen: so steht eine Spaltenbreite schon im ersten Bild und springt
 * nicht. Ohne Leinwand (jsdom) eine Schätzung von 0,62 Schriftgrößen je Zeichen, eher darüber.
 * Ein Puffer von 2 px fängt Subpixel und eine noch nicht geladene Schrift.
 */
let leinwand: CanvasRenderingContext2D | null | undefined;

export function textBreite(
  text: string,
  {
    schrift,
    groesse,
    gewicht,
    sperrung = 0,
  }: { schrift: string; groesse: number; gewicht: number; sperrung?: number },
): number {
  const zusatz = text.length * sperrung * groesse;
  if (leinwand === undefined) {
    try {
      leinwand =
        typeof document === 'undefined'
          ? null
          : (document.createElement('canvas').getContext('2d') ?? null);
    } catch {
      leinwand = null;
    }
  }
  if (!leinwand) return text.length * 0.62 * groesse + zusatz;
  leinwand.font = `${gewicht} ${groesse}px ${schrift || 'sans-serif'}`;
  return leinwand.measureText(text).width + zusatz + 2;
}

/**
 * Die Schriftfamilie des Fließtexts (`--lfh-schrift-text`) für {@link textBreite}, einmal je Montage
 * gelesen. Leer, solange es kein Dokument gibt; dann misst die Leinwand in der Vorgabeschrift.
 */
export function leseTextSchrift(): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue('--lfh-schrift-text').trim();
}
