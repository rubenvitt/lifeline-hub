import type {
  Meldung,
  MeldungKorrekturPatch,
  MeldungPrioritaet,
  Meldungsart,
  Richtung,
} from '../api/types';

/**
 * Kern der Korrektur einer Meldung (LLH-1066): Startwerte, die gesendete Änderung und die
 * angebotenen Werte. Ohne React, damit die Regeln für sich testbar sind.
 */

/** Werte des Bearbeitens an der Karte. `von` wie im Erfassen: `einheit:<id>` / `abschnitt:<id>`. */
export interface KorrekturWerte {
  meldungsart: Meldungsart;
  prioritaet: MeldungPrioritaet;
  richtung: Richtung;
  von?: string;
  empfaenger?: string;
}

/** Der Von-Bezug einer Meldung als Auswahlwert, `undefined` ohne Bezug. */
export function vonWert(m: Pick<Meldung, 'einheit_id' | 'abschnitt_id'>): string | undefined {
  if (m.einheit_id != null) return `einheit:${m.einheit_id}`;
  if (m.abschnitt_id != null) return `abschnitt:${m.abschnitt_id}`;
  return undefined;
}

export function korrekturStartwerte(m: Meldung): KorrekturWerte {
  return {
    meldungsart: m.meldungsart,
    prioritaet: m.prioritaet,
    richtung: m.richtung,
    von: vonWert(m),
    empfaenger: m.empfaenger ?? '',
  };
}

/** `einheit:<id>` / `abschnitt:<id>` → das Paar, wie der Server es ersetzt. */
function vonPaar(von: string | undefined): {
  einheit_id: number | null;
  abschnitt_id: number | null;
} {
  const treffer = /^(einheit|abschnitt):(\d+)$/.exec(von ?? '');
  if (!treffer) return { einheit_id: null, abschnitt_id: null };
  const id = Number(treffer[2]);
  return treffer[1] === 'einheit'
    ? { einheit_id: id, abschnitt_id: null }
    : { einheit_id: null, abschnitt_id: id };
}

/**
 * Nur die geänderten Felder (design.md D9): ein gleicher Wert geht nicht mit, damit die Korrektur
 * nichts überschreibt, was jemand anderes inzwischen geändert hat. Der Von-Bezug geht als Paar.
 * Leer = keine Änderung, die Karte sendet dann nichts.
 */
export function korrekturAenderung(m: Meldung, w: KorrekturWerte): MeldungKorrekturPatch {
  const a: MeldungKorrekturPatch = {};
  if (w.meldungsart !== m.meldungsart) a.meldungsart = w.meldungsart;
  if (w.prioritaet !== m.prioritaet) a.prioritaet = w.prioritaet;
  if (w.richtung !== m.richtung) a.richtung = w.richtung;
  if ((w.von ?? undefined) !== vonWert(m)) Object.assign(a, vonPaar(w.von));
  const empfaenger = w.empfaenger?.trim() ?? '';
  if (empfaenger !== (m.empfaenger ?? '')) a.empfaenger = empfaenger === '' ? null : empfaenger;
  return a;
}

export function istLeer(a: MeldungKorrekturPatch): boolean {
  return Object.keys(a).length === 0;
}

/** Sofort (Art oder Priorität), wie am Server (`MeldungAnzeige::ist_sofort`). */
export function istSofort(m: Pick<Meldung, 'meldungsart' | 'prioritaet'>): boolean {
  return m.meldungsart === 'sofortmeldung' || m.prioritaet === 'sofort';
}

/**
 * Zur Sofortmeldung wird eine Meldung beim Erfassen (design.md D8): die Karte bietet „Sofort“ und
 * „Sofortmeldung“ nur einer Meldung an, die schon sofort ist. Der Server lehnt das Heraufstufen
 * ohnehin ab (422).
 */
export function angeboteneWerte<V extends string>(
  optionen: { value: V; label: string }[],
  sofortWert: V,
  m: Pick<Meldung, 'meldungsart' | 'prioritaet'>,
): { value: V; label: string }[] {
  return istSofort(m) ? optionen : optionen.filter((o) => o.value !== sofortWert);
}

/** Werte der Lage-Angaben einer Meldung in der Lage (Lage-Text, Verortung). */
export interface LageWerte {
  text: string;
  ort: { lat: number; lon: number } | null;
}

/**
 * Nur die geänderten Lage-Angaben. Ein leerer Text lässt den Wortlaut gelten (`''` am Server);
 * ein entfernter Ort geht als `null`-Paar.
 */
export function lageAenderung(
  vorher: { text: string; lat?: number | null; lon?: number | null },
  w: LageWerte,
): MeldungKorrekturPatch {
  const a: MeldungKorrekturPatch = {};
  const text = w.text.trim();
  if (text !== vorher.text) a.lage_text = text;
  const alt =
    vorher.lat != null && vorher.lon != null ? { lat: vorher.lat, lon: vorher.lon } : null;
  if (w.ort?.lat !== alt?.lat || w.ort?.lon !== alt?.lon) {
    a.lat = w.ort?.lat ?? null;
    a.lon = w.ort?.lon ?? null;
  }
  return a;
}
