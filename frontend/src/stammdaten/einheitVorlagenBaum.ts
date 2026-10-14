import type { EinheitVorlage } from '../api/types';
import { staerkeText } from '../anzeige/staerke';
import { mitVorgabe } from '../components/vorgabeText';

/**
 * Baumform und Anzeige der Einheiten-Vorlagen (LLH-1042) für Liste und Detailseite: rein, ohne
 * React. Ein eigener Kern, weil Liste und Detailseite dieselbe Ordnung und Schreibweise brauchen.
 */

/** Wirksames Soll in BOS-Schreibweise; das des Einheitstyps trägt „(Vorgabe)“ (LFH-944). */
export function sollText(v: EinheitVorlage): string {
  if (!v.soll) return '—';
  return v.soll_eigen ? staerkeText(v.soll) : mitVorgabe(staerkeText(v.soll));
}

export interface VorlageRow {
  vorlage: EinheitVorlage;
  /** 0 = Wurzel. */
  depth: number;
}

/**
 * Wurzeln in der Reihenfolge des Servers, jede gefolgt von ihren Untereinheiten (tiefer zuerst).
 * Wurzel ist, wer keine Unterstellung hat oder dessen Elternvorlage nicht in der Menge steht.
 * Der Server schließt Zyklen aus; ein korrupter Zyklus fällt hier trotzdem nicht in eine
 * Endlosschleife: er erscheint am Ende, sein erstes Glied als Wurzel.
 */
export function orderAsTree(vorlagen: readonly EinheitVorlage[]): VorlageRow[] {
  const ids = new Set(vorlagen.map((v) => v.id));
  const children = new Map<number, EinheitVorlage[]>();
  for (const v of vorlagen) {
    const parent = v.ueber_vorlage_id;
    if (parent != null && ids.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), v]);
    }
  }
  const rows: VorlageRow[] = [];
  const visited = new Set<number>();
  const visit = (v: EinheitVorlage, depth: number) => {
    if (visited.has(v.id)) return;
    visited.add(v.id);
    rows.push({ vorlage: v, depth });
    for (const kind of children.get(v.id) ?? []) visit(kind, depth + 1);
  };
  for (const v of vorlagen) {
    if (v.ueber_vorlage_id == null || !ids.has(v.ueber_vorlage_id)) visit(v, 0);
  }
  for (const v of vorlagen) visit(v, 0);
  return rows;
}

/**
 * Name mit allen Elternvorlagen der Menge: „Sanitätszug Musterstadt › Rettungsstaffel“ (LLH-1049,
 * design.md D1: eine Untervorlage ist allein bildbar und braucht ihren Ort im Namen). Eine nicht
 * gelistete (etwa deaktivierte) Elternvorlage beendet den Pfad; ein Zyklus ebenso.
 */
export function vorlagePfad(vorlagen: readonly EinheitVorlage[], v: EinheitVorlage): string {
  const byId = new Map(vorlagen.map((x) => [x.id, x]));
  const namen = [v.name];
  const gesehen = new Set([v.id]);
  let eltern = v.ueber_vorlage_id != null ? byId.get(v.ueber_vorlage_id) : undefined;
  while (eltern && !gesehen.has(eltern.id)) {
    namen.unshift(eltern.name);
    gesehen.add(eltern.id);
    eltern = eltern.ueber_vorlage_id != null ? byId.get(eltern.ueber_vorlage_id) : undefined;
  }
  return namen.join(' › ');
}

/** Die Vorlage selbst und alle ihre Nachfahren: als Unterstellung ausgeschlossen (Zyklus). */
export function subtreeIds(vorlagen: readonly EinheitVorlage[], rootId: number): Set<number> {
  const result = new Set<number>([rootId]);
  let grown = true;
  while (grown) {
    grown = false;
    for (const v of vorlagen) {
      if (v.ueber_vorlage_id != null && result.has(v.ueber_vorlage_id) && !result.has(v.id)) {
        result.add(v.id);
        grown = true;
      }
    }
  }
  return result;
}

/** Alle Vorlagen des Baums, in dem `id` steht (Wurzel und Nachfahren): ein Fahrzeug oder eine
 *  Person steht darin höchstens einmal (Spec `einheit-vorlagen`). */
export function treeIds(vorlagen: readonly EinheitVorlage[], id: number): Set<number> {
  const byId = new Map(vorlagen.map((v) => [v.id, v]));
  const seen = new Set<number>();
  let root = id;
  for (;;) {
    seen.add(root);
    const parent = byId.get(root)?.ueber_vorlage_id;
    if (parent == null || !byId.has(parent) || seen.has(parent)) break;
    root = parent;
  }
  return subtreeIds(vorlagen, root);
}
