import { parseAnySpec, serializeAnySpec } from '@einsatzzeichen/core';
import { isFreestandingSpec } from '@einsatzzeichen/schema';
import type { FreiesZeichenUpdate } from '../../api/types';
import { sicherEntfernen, sicherLesen, sicherSchreiben } from '../../lib/sichererSpeicher';
import { freiesZeichen } from '../../zeichen/freiesZeichen';

/**
 * „Zuletzt verwendete" taktische Zeichen (LFH-716; seit LFH-836 als Zeichenbeschreibung, D10).
 *
 * **`localStorage`, nicht der Ansichts-Konfig-Bag:** welche Zeichen ich zuletzt gesetzt habe, ist
 * eine persönliche Bediengewohnheit und keine geteilte Ansichtseigenschaft.
 *
 * **Geschrieben wird beim Platzieren, nicht beim Ändern des Entwurfs.** Der Picker meldet bei jedem
 * Kachelklick eine neue Spec; hinge das Merken daran, stünden Zwischenstände eines Zeichens in der
 * Leiste. Deshalb ruft die Platzier-Stelle {@link merkeZuletztVerwendet}, nicht der Picker.
 *
 * **Ein Eintrag ist `{ spec }`** mit der kanonischen Serialisierung (`serializeAnySpec`); die Farbe
 * steckt darin. Bezeichnung, Ansicht und Koordinate gehören nicht zum Zeichen: der Name legte sonst
 * einen zweiten „EA Nord" an, die Ansicht legte das Zeichen auf einer fremden ab, und ein
 * Koordinatenpaar machte jede Platzierung zu einem eigenen Eintrag.
 */
const SPEICHER_SCHLUESSEL = 'lfh:lagekarte:zeichen-zuletzt-v2';

/**
 * Die Leiste vor LFH-836 (Kennungen des Altpakets). Beim ersten Lesen ohne v2 über den Leseadapter
 * übernommen und danach gelöscht (D10).
 */
const ALT_SCHLUESSEL = 'lfh:lagekarte:zeichen-zuletzt';

/** Sechs Kacheln passen in eine Leiste von ~390 px, ohne dass sie scrollen muss. */
export const ZULETZT_MAX = 6;

/** Die kanonische Form einer Serialisierung; `null`, wenn sie unlesbar ist. */
function kanonisch(roh: unknown): string | null {
  if (typeof roh !== 'string') return null;
  try {
    return serializeAnySpec(parseAnySpec(roh));
  } catch {
    return null;
  }
}

function entdupliziere(liste: readonly string[]): string[] {
  return [...new Set(liste)].slice(0, ZULETZT_MAX);
}

function schreibe(liste: readonly string[]): void {
  // Nicht verfügbar: nicht persistierbar, kein harter Fehler.
  sicherSchreiben(SPEICHER_SCHLUESSEL, JSON.stringify(liste.map((spec) => ({ spec }))));
}

/**
 * Ein Alteintrag in der neuen Darstellung. Entfällt, wenn er kein Grundzeichen trägt oder der
 * Leseadapter nur den Platzhalter findet: ein Punkt, den niemand gewählt hat, ist kein Vorschlag.
 */
function ausAltEintrag(eintrag: unknown): string | null {
  if (eintrag == null || typeof eintrag !== 'object') return null;
  const roh = eintrag as Record<string, unknown>;
  const text = (feld: string) => (typeof roh[feld] === 'string' ? (roh[feld] as string) : null);
  if (!text('grundzeichen')) return null;
  const bild = freiesZeichen({
    grundzeichen: text('grundzeichen'),
    organisation: text('organisation'),
    fachaufgabe: text('fachaufgabe'),
    symbol: text('symbol'),
    einheit: text('einheit'),
    funktion: text('funktion'),
    farbe: text('farbe'),
  });
  if (bild.vereinfacht && !isFreestandingSpec(bild.spec) && bild.spec.kind === 'point') return null;
  return serializeAnySpec(bild.spec);
}

/** Übernimmt die alte Leiste (falls da) nach v2 und löscht sie; liefert die übernommenen Einträge. */
function uebernimmAlteLeiste(): string[] {
  const roh = sicherLesen(ALT_SCHLUESSEL);
  if (roh == null) return [];
  let liste: string[] = [];
  try {
    const geparst: unknown = JSON.parse(roh);
    if (Array.isArray(geparst)) {
      liste = entdupliziere(geparst.map(ausAltEintrag).filter((s): s is string => s !== null));
    }
  } catch {
    // Kaputt: nichts zu übernehmen, weg damit.
  }
  if (liste.length > 0) schreibe(liste);
  sicherEntfernen(ALT_SCHLUESSEL);
  return liste;
}

/** Die Leiste als kanonische Serialisierungen, das jüngste vorn. Wirft nie. */
export function leseZuletztVerwendet(): string[] {
  const roh = sicherLesen(SPEICHER_SCHLUESSEL);
  if (roh == null) return uebernimmAlteLeiste();
  try {
    const geparst: unknown = JSON.parse(roh);
    if (!Array.isArray(geparst)) return [];
    return entdupliziere(
      geparst
        .map((e) => kanonisch((e as { spec?: unknown } | null)?.spec))
        .filter((s): s is string => s !== null),
    );
  } catch {
    /* kaputtes JSON → keine Vorschläge; eine Bedienvorliebe darf die Karte nicht mitnehmen */
    return [];
  }
}

/** Merkt das Zeichen einer Platzierung; die übrigen Felder (Name, Ansicht, Ort) fallen weg. */
export function merkeZuletztVerwendet(
  platzierung: Pick<FreiesZeichenUpdate, 'zeichen_spec'>,
): void {
  const neu = kanonisch(platzierung.zeichen_spec);
  if (!neu) return;
  // Das Jüngste nach vorn; das gleiche Zeichen weiter hinten fällt beim Entduplizieren weg — ein
  // erneut benutztes Zeichen wandert also.
  schreibe(entdupliziere([neu, ...leseZuletztVerwendet()]));
  benachrichtige();
}

/**
 * Die Leiste im Picker muss sich nach einer Platzierung erneuern; geschrieben wird aber anderswo,
 * und der Picker bleibt die ganze Sitzung montiert.
 *
 * Bewusst kein gecachter Schnappschuss für `useSyncExternalStore`: er müsste zwischen Tests
 * zurückgesetzt werden und wäre eine zweite Wahrheit neben dem Speicher. Der Abonnent liest neu.
 */
const hoerer = new Set<() => void>();

export function abonniereZuletztVerwendet(fn: () => void): () => void {
  hoerer.add(fn);
  return () => {
    hoerer.delete(fn);
  };
}

function benachrichtige(): void {
  for (const fn of hoerer) fn();
}
