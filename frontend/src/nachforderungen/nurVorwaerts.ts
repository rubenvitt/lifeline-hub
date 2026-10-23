import type { Nachforderung } from '../api/types';

/**
 * „Nur vorwärts“ (LLH-1387 design.md D5), gespiegelt für die Karte (LLH-1395): trägt eine
 * Nachforderung eine verknüpfte Einheit, lehnt der Server jede Rücknahme einer Stufe, „Ablehnen“
 * und „Zurückziehen“ mit 422 ab (`routes/nachforderung.rs`, `status`, `ablehnen`,
 * `zurueckziehen`). Die Regel des Servers ist die Quelle; `einheit_ids` trägt dieselbe Bedingung
 * wie `repo::has_einheiten` (auch aufgelöste zählen). Ein Knopf, der 422 liefert, ist schlechter
 * als keiner (`kommunikation/rueckgaengig.tsx`).
 */

type Bezug = Pick<Nachforderung, 'status' | 'einheit_ids' | 'material_ids'>;

/** Kurzgrund im Wortlaut des gesperrten Menüeintrags („Ablehnen (Einheiten verknüpft)“). */
export const EINHEITEN_VERKNUEPFT = 'Einheiten verknüpft';

/** Stufen, aus denen der Server genau eine Stufe zurücknimmt (`uebergang_erlaubt`). */
const MIT_RUECKWEG: ReadonlySet<Nachforderung['status']> = new Set([
  'zugesagt',
  'unterwegs',
  'eingetroffen',
]);

/** Ist mindestens eine Einheit mit der Nachforderung verknüpft? */
export function hatVerknuepfteEinheiten(n: Pick<Nachforderung, 'einheit_ids'>): boolean {
  return n.einheit_ids.length > 0;
}

/**
 * Warum der Server die Rücknahme um eine Stufe ablehnt (Rückgängig-Toast), `null`, wenn er sie
 * annimmt: nicht mit verknüpfter Einheit (LLH-1387 D5), nicht aus „eingetroffen“ mit übernommenem
 * Material (LLH-1226 D9) und nicht vom Anfang der Kette oder aus einem Abschluss.
 */
export function ruecknahmeSperre(n: Bezug): string | null {
  if (!MIT_RUECKWEG.has(n.status)) return 'kein Rückweg';
  if (hatVerknuepfteEinheiten(n)) return EINHEITEN_VERKNUEPFT;
  if (n.status === 'eingetroffen' && n.material_ids.length > 0) return 'Material übernommen';
  return null;
}

/** Nimmt der Server die Rücknahme um eine Stufe an? */
export function kannZuruecknehmen(n: Bezug): boolean {
  return ruecknahmeSperre(n) == null;
}

/** Dürfen „Ablehnen“ und „Zurückziehen“ angeboten werden? Nicht mit verknüpfter Einheit (D5). */
export function kannAbschliessen(n: Pick<Nachforderung, 'einheit_ids'>): boolean {
  return !hatVerknuepfteEinheiten(n);
}

/**
 * Wie die Karte ihre verknüpften Einheiten einleitet. Vor dem Eintreffen der Nachforderung
 * verknüpft nur die Buchung am Raum (LLH-1387 D4): die Einheit ist dort eingetroffen, nicht von
 * der Führung übernommen. Ab „eingetroffen“ bleibt „übernommen“, auch für eine vorher am Raum
 * gebuchte: der Verweis allein sagt nicht, welcher Weg ihn gesetzt hat.
 */
export function einheitenEinleitung(
  n: Pick<Nachforderung, 'status'>,
): 'Am Raum eingetroffen' | 'Als Einheit übernommen' {
  return n.status === 'zugesagt' || n.status === 'unterwegs'
    ? 'Am Raum eingetroffen'
    : 'Als Einheit übernommen';
}
