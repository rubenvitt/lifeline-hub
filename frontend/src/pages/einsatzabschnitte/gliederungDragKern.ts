import type { Einheit, Einsatzabschnitt } from '../../api/types';
import type { BaumKnoten } from '../../components/organigramm/baum';
import { nachfahrenInkl } from './abschnittStaerke';

/**
 * Der reine Teil des Umhängens in der Gliederung (LFH-1212): welches Ziel ein Zug oder das Menü
 * „Verschieben unter …“ annimmt. Ziehen und Menü lesen dieselben Regeln, damit der Client vorher
 * sperrt, was der Server ablehnte (Zyklus, `src/einsatzabschnitt/repo.rs`, `waere_zyklus`).
 */

/** Wortlaut des Ziels „ohne Über-Abschnitt“, im Menü wie an der Wurzelzone. */
export const OBERSTE_EBENE = 'Oberste Ebene';

/**
 * Darf der Abschnitt `gezogenId` unter `zielId` (`null` = oberste Ebene)? Gesperrt sind er selbst,
 * seine Nachfahren (Zyklus) und sein jetziger Ort (der Zug änderte nichts).
 */
export function canDropAbschnitt(
  abschnitte: readonly Einsatzabschnitt[],
  gezogenId: number,
  zielId: number | null,
): boolean {
  const gezogen = abschnitte.find((a) => a.id === gezogenId);
  if (!gezogen) return false;
  if ((gezogen.ueber_abschnitt_id ?? null) === zielId) return false;
  if (zielId === null) return true;
  return !nachfahrenInkl([...abschnitte], gezogenId).has(zielId);
}

/**
 * Darf eine Einheit in den Abschnitt `zielId`? Nur in einen anderen Abschnitt: „nicht zugeordnet“
 * ist kein Ort im Baum, das setzt die Einheit selbst (Feld „Abschnitt“).
 */
export function canDropEinheit(
  einheit: Pick<Einheit, 'abschnitt_id'>,
  zielId: number | null,
): boolean {
  return zielId !== null && (einheit.abschnitt_id ?? null) !== zielId;
}

export interface VerschiebeZiel {
  /** `null` = oberste Ebene. */
  id: number | null;
  name: string;
  /** Ebene im Baum, für den Einzug im Menü. */
  tiefe: number;
  /** Der jetzige Ort: steht im Menü, ist aber nicht wählbar. */
  jetzt: boolean;
}

/**
 * Die Ziele des Menüs „Verschieben unter …“ in Baumfolge: zuerst die oberste Ebene, dann jeder
 * Abschnitt außer dem verschobenen und seinen Nachfahren. Der jetzige Ort bleibt drin (`jetzt`),
 * sonst suchte man ihn.
 */
export function verschiebeZiele(
  abschnitte: readonly Einsatzabschnitt[],
  id: number,
): VerschiebeZiel[] {
  const verschoben = abschnitte.find((a) => a.id === id);
  const jetzt = verschoben?.ueber_abschnitt_id ?? null;
  const verboten = nachfahrenInkl([...abschnitte], id);
  const ziele: VerschiebeZiel[] = [
    { id: null, name: OBERSTE_EBENE, tiefe: 0, jetzt: jetzt === null },
  ];
  const walk = (knoten: readonly GliederungKnoten[], tiefe: number) => {
    for (const k of knoten) {
      if (verboten.has(k.abschnitt.id)) continue;
      ziele.push({
        id: k.abschnitt.id,
        name: k.abschnitt.name,
        tiefe,
        jetzt: k.abschnitt.id === jetzt,
      });
      walk(k.kinder, tiefe + 1);
    }
  };
  walk(buildGliederungKnoten(abschnitte), 0);
  return ziele;
}

/** Ein Knoten der Gliederung in der Form der Zufluss-Schleuse (`organigramm/baumSchleuse.ts`). */
export interface GliederungKnoten extends BaumKnoten<GliederungKnoten> {
  abschnitt: Einsatzabschnitt;
}

/**
 * Der Baum der Gliederung über `ueber_abschnitt_id`, in Lieferfolge. Ein Abschnitt, dessen
 * Über-Abschnitt nicht in der Liste steht, hängt an der Wurzel: verloren ginge er sonst still.
 */
export function buildGliederungKnoten(abschnitte: readonly Einsatzabschnitt[]): GliederungKnoten[] {
  const ids = new Set(abschnitte.map((a) => a.id));
  const kinder = new Map<number | null, Einsatzabschnitt[]>();
  for (const a of abschnitte) {
    const ueber =
      a.ueber_abschnitt_id != null && ids.has(a.ueber_abschnitt_id) ? a.ueber_abschnitt_id : null;
    if (!kinder.has(ueber)) kinder.set(ueber, []);
    kinder.get(ueber)!.push(a);
  }
  const build = (ueber: number | null): GliederungKnoten[] =>
    (kinder.get(ueber) ?? []).map((a) => ({
      key: String(a.id),
      abschnitt: a,
      kinder: build(a.id),
    }));
  return build(null);
}

/** Wortlaut des Rückgängig-Toasts nach einem Umhängen. */
export function verschiebeText(name: string, ziel: string | null): string {
  return ziel === null
    ? `„${name}“ auf die oberste Ebene verschoben`
    : `„${name}“ unter „${ziel}“ verschoben`;
}

/** Wortlaut des Rückgängig-Toasts nach dem Zuordnen einer Einheit. */
export function einheitVerschiebeText(name: string, ziel: string): string {
  return `„${name}“ zu „${ziel}“ zugeordnet`;
}

/**
 * Entfallene Knoten aus dem gezeigten Stand der Schleuse nehmen (wie die `Datensicht`: die
 * Gliederung stützt kein Spalten-Grid, ein Platzhalter wäre eine eigene Darstellung). Ihre
 * gehaltenen Kinder rücken an ihren Platz, statt mit ihnen zu verschwinden — ein aufgelöster
 * Abschnitt hebt seine Unterabschnitte eine Ebene hoch.
 */
export function removeEntfallenes<K extends BaumKnoten<K>>(
  knoten: readonly K[],
  entfallen: ReadonlySet<string>,
): K[] {
  return knoten.flatMap((k) => {
    const kinder = removeEntfallenes(k.kinder, entfallen);
    return entfallen.has(k.key) ? kinder : [{ ...k, kinder }];
  });
}

/** Schlüssel aller Knoten mit Kindern, für das Aufklappen in der Gliederung. */
export function elternKeys(knoten: readonly GliederungKnoten[]): number[] {
  return knoten.flatMap((k) =>
    k.kinder.length > 0 ? [k.abschnitt.id, ...elternKeys(k.kinder)] : [],
  );
}
