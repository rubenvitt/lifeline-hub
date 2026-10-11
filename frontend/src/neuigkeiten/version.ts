/**
 * Reihenfolge zweier Versionen der Form `X.Y.Z`, `X.Y.Z-alpha.N` oder `X.Y.Z-beta.N` (Spec
 * `neuigkeiten`: der Punkt gilt, solange der Lesestand VOR der laufenden Version liegt). Ohne die
 * CHANGELOG, damit das Benutzermenü die Notizen nicht mitlädt.
 */

const FORM = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/;
// Ohne Vorabkennung ist die Version stabil und steht nach allen Vorabversionen derselben Nummer.
const VORAB_RANG = { alpha: 0, beta: 1, stabil: 2 } as const;

function zerlege(version: string): number[] | null {
  const t = FORM.exec(version);
  if (!t) return null;
  const [, major, minor, patch, vorab, n] = t;
  const rang = VORAB_RANG[(vorab as 'alpha' | 'beta' | undefined) ?? 'stabil'];
  return [Number(major), Number(minor), Number(patch), rang, Number(n ?? 0)];
}

/**
 * Liegt `a` vor `b`? Eine unlesbare Version zählt als vorher, sobald sie sich von `b` unterscheidet:
 * lieber ein Hinweis zu viel als ein verlorener.
 */
export function istVersionVor(a: string, b: string): boolean {
  const za = zerlege(a);
  const zb = zerlege(b);
  if (!za || !zb) return a !== b;
  for (let i = 0; i < za.length; i++) {
    if (za[i] !== zb[i]) return za[i] < zb[i];
  }
  return false;
}
