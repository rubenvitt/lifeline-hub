import type { EinsatzFahrzeug, Einsatzabschnitt } from '../../api/types';
import { abschnittDerEinheit, type AbschnittTraeger } from '../../kraefte/kraeftebaumKern';
import type { GeoJsonPolygon } from './geo';
import type { KarteMarker } from './marker';

/**
 * Fokus auf einen Einsatzabschnitt (LLH-1057, Spec `lagekarte-abschnitt-fokus`): reine Ableitungen.
 * Der Fokus ist Darstellung, kein Filter — er dämpft die Kräfte fremder Abschnitte über ihre
 * Deckkraft und entfernt nichts. Ebenen, Zähler und Suche sehen ihn nicht.
 */

/** Deckkraft gedämpfter Kräfte, als Faktor auf die volle Deckkraft des Layers. */
export const GEDAEMPFT_DECKKRAFT = 0.35;

/** Was der Fokus aus den Rohdaten der Karte liest. */
export interface FokusQuelle {
  abschnitte: readonly Pick<Einsatzabschnitt, 'id' | 'name' | 'ueber_abschnitt_id'>[];
  einheiten: readonly AbschnittTraeger[];
  fahrzeuge: readonly Pick<EinsatzFahrzeug, 'id' | 'einheit_id'>[];
}

/** Der fokussierte Abschnitt, aufbereitet für Dämpfen und Rahmen. */
export interface FokusSicht {
  abschnittId: number;
  name: string;
  /** Der fokussierte Abschnitt samt Unterabschnitten: was hier liegt, ist eigen. */
  eigene: ReadonlySet<number>;
  /**
   * Abschnitt je Kräfte-Marker (Schlüssel): Einheiten, Fahrzeuge, Abschnittszeichen. `null` = ohne
   * Abschnitt. Wer fehlt (Führungskräfte, alle Nicht-Kräfte), wird nie gedämpft.
   */
  zuordnung: ReadonlyMap<string, number | null>;
}

/** Rahmen eines Anflugs: `[[west, süd], [ost, nord]]`, wie `fitBounds` ihn nimmt. */
export type Rahmen = [[number, number], [number, number]];

/** Ein Abschnitt und alle darunter (über `ueber_abschnitt_id`), zyklenfest. */
export function eigeneAbschnitte(
  abschnittId: number,
  abschnitte: readonly Pick<Einsatzabschnitt, 'id' | 'ueber_abschnitt_id'>[],
): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const a of abschnitte) {
    if (a.ueber_abschnitt_id == null) continue;
    const liste = kinder.get(a.ueber_abschnitt_id) ?? [];
    liste.push(a.id);
    kinder.set(a.ueber_abschnitt_id, liste);
  }
  const eigene = new Set<number>([abschnittId]);
  const offen = [abschnittId];
  while (offen.length) {
    for (const kind of kinder.get(offen.pop()!) ?? []) {
      if (eigene.has(kind)) continue;
      eigene.add(kind);
      offen.push(kind);
    }
  }
  return eigene;
}

/**
 * Abschnitt je Kräfte-Marker. Einheiten nach `abschnittDerEinheit` (eigener, sonst geerbter — die
 * Lesart von Inspector und Listen), Fahrzeuge über ihre Einheit, Abschnittszeichen über sich selbst.
 */
export function kraefteZuordnung(quelle: FokusQuelle): Map<string, number | null> {
  const jeEinheit = abschnittDerEinheit(quelle.einheiten);
  const zuordnung = new Map<string, number | null>();
  for (const [id, abschnitt] of jeEinheit) zuordnung.set(`einheit-${id}`, abschnitt?.id ?? null);
  for (const f of quelle.fahrzeuge) {
    const abschnitt = f.einheit_id != null ? jeEinheit.get(f.einheit_id) : null;
    zuordnung.set(`fahrzeug-${f.id}`, abschnitt?.id ?? null);
  }
  for (const a of quelle.abschnitte) zuordnung.set(`abschnitt-${a.id}`, a.id);
  return zuordnung;
}

/** Fokus-Sicht auf einen Abschnitt; `null`, wenn die Karte ihn nicht kennt. */
export function baueFokusSicht(abschnittId: number, quelle: FokusQuelle): FokusSicht | null {
  const abschnitt = quelle.abschnitte.find((a) => a.id === abschnittId);
  if (!abschnitt) return null;
  return {
    abschnittId,
    name: abschnitt.name,
    eigene: eigeneAbschnitte(abschnittId, quelle.abschnitte),
    zuordnung: kraefteZuordnung(quelle),
  };
}

/** Gehört der Marker zu den Kräften eines fremden Abschnitts? */
function istFremd(schluessel: string, sicht: FokusSicht): boolean {
  const abschnitt = sicht.zuordnung.get(schluessel);
  return abschnitt != null && !sicht.eigene.has(abschnitt);
}

/**
 * Markiert die Kräfte fremder Abschnitte als gedämpft; nichts fällt weg. Ohne Fokus dieselbe Liste,
 * ungedämpfte Marker behalten ihre Identität.
 */
export function daempfeMarker<T extends KarteMarker>(markers: T[], sicht: FokusSicht | null): T[] {
  if (!sicht) return markers;
  return markers.map((m) => (istFremd(m.schluessel, sicht) ? { ...m, gedaempft: true } : m));
}

/** Markiert die Flächen fremder Abschnitte als gedämpft. Ohne Fokus dieselbe Liste. */
export function daempfeFlaechen<T extends { id: number }>(
  flaechen: readonly T[],
  sicht: FokusSicht | null,
): readonly (T & { gedaempft?: true })[] {
  if (!sicht) return flaechen;
  return flaechen.map((f) => (sicht.eigene.has(f.id) ? f : { ...f, gedaempft: true as const }));
}

/** Umgebendes Rechteck einer Punktmenge; `null` ohne Punkte. */
function umgebend(punkte: readonly (readonly number[])[]): Rahmen | null {
  if (!punkte.length) return null;
  let [w, s] = [Infinity, Infinity];
  let [o, n] = [-Infinity, -Infinity];
  for (const [lon, lat] of punkte) {
    w = Math.min(w, lon);
    o = Math.max(o, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [
    [w, s],
    [o, n],
  ];
}

/**
 * Wohin der Fokus fliegt: die Fläche des Abschnitts; ohne sie die Flächen der Unterabschnitte und
 * die verorteten eigenen Kräfte. `null`, wenn nichts davon auf der Karte steht.
 */
export function fokusRahmen(
  sicht: FokusSicht,
  flaechen: readonly { id: number; polygon: GeoJsonPolygon }[],
  markers: readonly KarteMarker[],
): Rahmen | null {
  const eigeneFlaeche = flaechen.find((f) => f.id === sicht.abschnittId);
  if (eigeneFlaeche) return umgebend(eigeneFlaeche.polygon.coordinates.flat());
  const punkte: number[][] = flaechen
    .filter((f) => sicht.eigene.has(f.id))
    .flatMap((f) => f.polygon.coordinates.flat());
  for (const m of markers) {
    const abschnitt = sicht.zuordnung.get(m.schluessel);
    if (m.typ !== 'abschnitt' && abschnitt != null && sicht.eigene.has(abschnitt)) {
      punkte.push([m.lon, m.lat]);
    }
  }
  return umgebend(punkte);
}

/**
 * Wem gehört Esc bei aktivem Fokus? Erst der Auswahl, dann dem Fokus (LLH-1023, Esc-Reihenfolge).
 * Ohne Fokus fragt niemand: das Auswahl-Esc allein baut die Ansicht „Auswahl“ (LLH-1033).
 */
export function escZiel(auswahlOffen: boolean): 'auswahl' | 'fokus' {
  return auswahlOffen ? 'auswahl' : 'fokus';
}
