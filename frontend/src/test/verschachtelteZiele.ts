/**
 * Prüfung „kein Bedienziel in einem anderen“ für Vitest, nach axes Regel `nested-interactive`
 * (LLH-1426). Das Repo hat kein axe; diese Prüfung deckt den Teil der Regel ab, den die Bausteine
 * brauchen: ein Link oder Knopf in einem Knopf, Link oder einem Element mit Knopf-/Linkrolle.
 *
 * Liefert je Fund „innen in außen“ als lesbare Zeile, damit die Meldung im Test sagt, was steckt.
 */
const INTERAKTIV =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), ' +
  '[role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="tab"], ' +
  '[role="switch"], [role="option"]';

/** Hüllen, in denen kein weiteres Bedienziel stehen darf (axe: Rollen mit `childrenPresentational`). */
const HUELLE =
  'a[href], button, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], ' +
  '[role="tab"], [role="switch"], [role="option"]';

function beschreibe(el: Element): string {
  const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
  return `<${el.tagName.toLowerCase()}> „${name}“`;
}

export function verschachtelteZiele(wurzel: ParentNode): string[] {
  const funde: string[] = [];
  for (const el of wurzel.querySelectorAll(INTERAKTIV)) {
    const aussen = el.parentElement?.closest(HUELLE);
    if (aussen) funde.push(`${beschreibe(el)} in ${beschreibe(aussen)}`);
  }
  return funde;
}
