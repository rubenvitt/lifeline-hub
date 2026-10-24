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

/** Wie die Karte eine verknüpfte Einheit einleitet. */
export type EinheitenEinleitung = 'Am Raum eingetroffen' | 'Als Einheit übernommen';

/** Die verknüpften Einheiten einer Einleitung, in der Folge von `einheit_ids`. */
export interface EinheitenGruppe {
  einleitung: EinheitenEinleitung;
  ids: number[];
}

/**
 * Die verknüpften Einheiten der Karte nach ihrem Weg (LLH-1445): am Raum eingetroffen ist, wen
 * der Server unter `einheit_ids_am_raum` nennt, und vor dem Eintreffen der Nachforderung jede
 * (nur die Buchung am Raum verknüpft dann, LLH-1387 D4); alle übrigen sind übernommen. Feste Folge
 * am Raum vor übernommen, leere Gruppen fallen weg. Eine vor LLH-1445 am Raum verknüpfte Einheit
 * kennt der Server nicht als solche: sie heißt nach dem Eintreffen „übernommen“.
 */
export function einheitenGruppen(
  n: Pick<Nachforderung, 'status' | 'einheit_ids' | 'einheit_ids_am_raum'>,
): EinheitenGruppe[] {
  const vorEintreffen = n.status === 'zugesagt' || n.status === 'unterwegs';
  const amRaum = new Set(n.einheit_ids_am_raum);
  const gruppen: EinheitenGruppe[] = [
    {
      einleitung: 'Am Raum eingetroffen',
      ids: n.einheit_ids.filter((id) => vorEintreffen || amRaum.has(id)),
    },
    {
      einleitung: 'Als Einheit übernommen',
      ids: n.einheit_ids.filter((id) => !vorEintreffen && !amRaum.has(id)),
    },
  ];
  return gruppen.filter((g) => g.ids.length > 0);
}
