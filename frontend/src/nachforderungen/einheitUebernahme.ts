import { NACHFORDERUNG_UEBERNAHME_EINHEITEN_MAX } from '../api/eingabegrenzen';
import type {
  Einheit,
  EinheitenAusNachforderungEingabe,
  EinheitTyp,
  Nachforderung,
} from '../api/types';
import { normalizeFunkrufname } from '../pages/bereitstellungsraum/eintreffenKern';

/**
 * Übernahme einer eingetroffenen Nachforderung als Einheiten (LLH-1383, design.md D3, D4, D9,
 * D10), rein: was schon übernommen ist, was der Dialog vorbelegt, welche Zeile eine bestehende
 * Einheit verknüpft und was auf den Draht geht. Die Nachforderung kennt keine Einheiten, nur
 * Rufnamen; die Ableitung steht im Client, damit die Person vor dem Absenden sieht, was entsteht.
 */

type NachforderungBezug = Pick<
  Nachforderung,
  'id' | 'art' | 'anzahl' | 'status' | 'einheit_ids' | 'material_ids' | 'zusage_rufnamen'
>;
type EinheitBezug = Pick<
  Einheit,
  'id' | 'name' | 'funkrufname' | 'nachforderung_id' | 'aufgeloest_at'
>;

/** Was der Dialog trägt: drei Felder (Feldbudget Modal). */
export interface EinheitUebernahmeWerte {
  /** Je Eintrag eine Einheit: ein Rufname, neu oder schon im Einsatz. */
  einheiten: string[];
  typ_id: number | null;
  in_bereitstellungsraum: boolean;
}

/** Die Vergleichsform eines Namens wie am Server (`eintreffen::normalize`). */
const schluessel = normalizeFunkrufname;

/**
 * Die verknüpften Einheiten, soweit `einheiten` sie kennt, in der Folge der Kennungen. Eine
 * Einheit, die die Liste (noch) nicht hat, fehlt.
 */
export function uebernommeneEinheiten<E extends Pick<Einheit, 'id'>>(
  n: Pick<Nachforderung, 'einheit_ids'>,
  einheitenJeId: ReadonlyMap<number, E>,
): E[] {
  return n.einheit_ids.flatMap((id) => {
    const e = einheitenJeId.get(id);
    return e ? [e] : [];
  });
}

/** Wie viele Einheiten noch übernommen werden dürfen (D4); ohne Anzahl bis zur Grenze. */
export function restAnzahl(n: Pick<Nachforderung, 'anzahl' | 'einheit_ids'>): number {
  const grenze = n.anzahl ?? NACHFORDERUNG_UEBERNAHME_EINHEITEN_MAX;
  return Math.max(
    0,
    Math.min(grenze - n.einheit_ids.length, NACHFORDERUNG_UEBERNAHME_EINHEITEN_MAX),
  );
}

/**
 * Der Knopf steht an einer eingetroffenen Karte ohne übernommenes Material (Material und Einheit
 * schließen sich aus, D9), solange die Anzahl nicht ausgeschöpft ist.
 */
export function kannEinheitUebernehmen(
  n: Pick<Nachforderung, 'status' | 'anzahl' | 'einheit_ids' | 'material_ids'>,
): boolean {
  return n.status === 'eingetroffen' && n.material_ids.length === 0 && restAnzahl(n) > 0;
}

/** „Weitere Einheit übernehmen“, sobald schon eine verknüpft ist (LFH-959). */
export function isWeitereEinheit(n: Pick<Nachforderung, 'einheit_ids'>): boolean {
  return n.einheit_ids.length > 0;
}

/**
 * Vorbelegung „Einheiten“ (D4): die Rufnamen der Zusage, die noch keine verknüpfte Einheit tragen,
 * höchstens so viele wie noch übernommen werden dürfen. Ohne Rufnamen bleibt das Feld leer.
 */
export function einheitenVorbelegung(
  n: NachforderungBezug,
  einheiten: readonly EinheitBezug[],
): string[] {
  const verknuepft = new Set(
    einheiten
      .filter((e) => e.nachforderung_id === n.id)
      .flatMap((e) => [e.name, e.funkrufname ?? ''])
      .filter(Boolean)
      .map(schluessel),
  );
  const gesehen = new Set<string>();
  const offen: string[] = [];
  for (const roh of n.zusage_rufnamen) {
    const name = roh.trim();
    const s = schluessel(name);
    if (!name || verknuepft.has(s) || gesehen.has(s)) continue;
    gesehen.add(s);
    offen.push(name);
  }
  return offen.slice(0, restAnzahl(n));
}

/** Vorbelegung „Typ“ (D4): der Einheitstyp des Katalogs, dessen Label der Art gleicht. */
export function typVorbelegung(
  n: Pick<Nachforderung, 'art'>,
  typen: readonly Pick<EinheitTyp, 'id' | 'label'>[],
): number | null {
  const art = schluessel(n.art);
  return typen.find((t) => schluessel(t.label) === art)?.id ?? null;
}

/**
 * Die aktive Einheit, deren Name oder Funkrufname der Zeile gleicht (D3): sie wird verknüpft statt
 * neu angelegt. Aufgelöste zählen nicht, wie am Server.
 */
export function bestehendeEinheit<E extends EinheitBezug>(
  zeile: string,
  einheiten: readonly E[],
): E | null {
  const s = schluessel(zeile);
  if (!s) return null;
  return (
    einheiten.find(
      (e) =>
        e.aufgeloest_at == null &&
        (schluessel(e.name) === s || (e.funkrufname != null && schluessel(e.funkrufname) === s)),
    ) ?? null
  );
}

/**
 * Vorschläge für „Wer“ an Zusage und Bearbeiten (D10): Funkrufname oder Name der aktiven
 * Einheiten, die noch aus keiner Nachforderung stammen, sortiert und ohne Doppelte.
 */
export function einheitVorschlaege(einheiten: readonly EinheitBezug[]): string[] {
  const gesehen = new Set<string>();
  const namen: string[] = [];
  for (const e of einheiten) {
    if (e.aufgeloest_at != null || e.nachforderung_id != null) continue;
    const name = (e.funkrufname ?? '').trim() || e.name.trim();
    const s = schluessel(name);
    if (!s || gesehen.has(s)) continue;
    gesehen.add(s);
    namen.push(name);
  }
  return namen.sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
}

/** Die Zeilen getrimmt, ohne Leere, ohne Doppelte nach der Vergleichsform, in Eingabefolge. */
export function bereinigeZeilen(zeilen: readonly string[] | null | undefined): string[] {
  const gesehen = new Set<string>();
  const ergebnis: string[] = [];
  for (const roh of zeilen ?? []) {
    const z = roh.trim();
    const s = schluessel(z);
    if (!z || gesehen.has(s)) continue;
    gesehen.add(s);
    ergebnis.push(z);
  }
  return ergebnis;
}

/**
 * Body von `POST …/einheiten/aus-nachforderung` (D2, D3): eine Zeile, die einer aktiven Einheit
 * gleicht, verknüpft sie per Kennung, jede andere legt eine Einheit an.
 */
export function einheitenBody(
  n: Pick<Nachforderung, 'id'>,
  w: EinheitUebernahmeWerte,
  einheiten: readonly EinheitBezug[],
): EinheitenAusNachforderungEingabe {
  return {
    nachforderung_id: n.id,
    einheiten: bereinigeZeilen(w.einheiten).map((name) => {
      const e = bestehendeEinheit(name, einheiten);
      return e ? { einheit_id: e.id } : { name };
    }),
    ...(w.typ_id != null ? { typ_id: w.typ_id } : {}),
    ...(w.in_bereitstellungsraum ? { in_bereitstellungsraum: true } : {}),
  };
}
