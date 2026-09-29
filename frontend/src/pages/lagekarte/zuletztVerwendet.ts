import type { FreiesZeichenUpdate } from '../../api/types';

/**
 * „Zuletzt verwendete" taktische Zeichen (LFH-716).
 *
 * **`localStorage`, nicht der Ansichts-Konfig-Bag:** welche Zeichen ich zuletzt gesetzt habe, ist
 * eine persönliche Bediengewohnheit und keine geteilte Ansichtseigenschaft.
 *
 * **Geschrieben wird beim Platzieren, nicht beim Ändern des Entwurfs.** Der Picker meldet bei jedem
 * Kachelklick eine neue Spec; hinge das Merken daran, stünden Zwischenstände eines Zeichens in der
 * Leiste. Deshalb ruft die Platzier-Stelle {@link merkeZuletztVerwendet}, nicht der Picker.
 */
const SPEICHER_SCHLUESSEL = 'lfh:lagekarte:zeichen-zuletzt';

/** Sechs Kacheln passen in eine Leiste von ~390 px, ohne dass sie scrollen muss. */
export const ZULETZT_MAX = 6;

/**
 * Die sieben Felder, die das Zeichen ausmachen — in fester Reihenfolge, weil daraus Eintrag und
 * Dublettenschlüssel entstehen.
 */
const ZEICHEN_FELDER = [
  'grundzeichen',
  'organisation',
  'fachaufgabe',
  'symbol',
  'einheit',
  'funktion',
  'farbe',
] as const;

/**
 * Reduziert eine beliebige Spec auf das Zeichen.
 *
 * **Zwei Felder fallen bewusst weg.** `label` ist der Name einer Platzierung: mitgebracht legte er
 * einen zweiten „EA Nord" an, im Dublettenschlüssel machte er aus einem Zeichen zwei Einträge.
 * `ansicht_id` bindet an die beim Platzieren aktive Ansicht; ein Altwert legte das Zeichen auf
 * einer fremden ab.
 *
 * **Gepflückt, nicht kopiert-und-gelöscht:** an der Platzier-Stelle liegt ein `NeuesFreiesZeichen`
 * mit lat/lon; ein durchgereichtes Koordinatenpaar machte jede Platzierung zu einem eigenen
 * Schlüssel.
 */
function nurDasZeichen(spec: FreiesZeichenUpdate): FreiesZeichenUpdate {
  const roh = spec as Record<string, unknown>;
  const zeichen: Record<string, unknown> = {};
  for (const feld of ZEICHEN_FELDER) zeichen[feld] = roh[feld] ?? null;
  return zeichen as unknown as FreiesZeichenUpdate;
}

function schluessel(z: FreiesZeichenUpdate): string {
  const roh = z as Record<string, unknown>;
  return ZEICHEN_FELDER.map((feld) => String(roh[feld] ?? '')).join('|');
}

/**
 * Ein Eintrag ohne Grundzeichen wird einzeln verworfen, der Rest der Liste bleibt. (Ein ganz
 * kaputter Speicherinhalt fällt eine Ebene höher weg.)
 */
function istBrauchbar(eintrag: unknown): eintrag is FreiesZeichenUpdate {
  if (eintrag == null || typeof eintrag !== 'object') return false;
  const gz = (eintrag as Record<string, unknown>).grundzeichen;
  return typeof gz === 'string' && gz.length > 0;
}

export function leseZuletztVerwendet(): FreiesZeichenUpdate[] {
  try {
    const roh = localStorage.getItem(SPEICHER_SCHLUESSEL);
    if (!roh) return [];
    const geparst: unknown = JSON.parse(roh);
    if (!Array.isArray(geparst)) return [];
    return entdupliziere(geparst.filter(istBrauchbar).map(nurDasZeichen));
  } catch {
    /* kein Speicher, kaputtes JSON → keine Vorschläge; eine Bedienvorliebe darf die Karte
       nicht mitnehmen */
    return [];
  }
}

function entdupliziere(liste: FreiesZeichenUpdate[]): FreiesZeichenUpdate[] {
  const gesehen = new Set<string>();
  const raus: FreiesZeichenUpdate[] = [];
  for (const z of liste) {
    const k = schluessel(z);
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    raus.push(z);
    if (raus.length === ZULETZT_MAX) break;
  }
  return raus;
}

export function merkeZuletztVerwendet(spec: FreiesZeichenUpdate): void {
  const neu = nurDasZeichen(spec);
  // Das Jüngste nach vorn; das gleiche Zeichen weiter hinten fällt beim Entduplizieren weg — ein
  // erneut benutztes Zeichen wandert also.
  const liste = entdupliziere([neu, ...leseZuletztVerwendet()]);
  try {
    localStorage.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(liste));
  } catch {
    /* nicht verfügbar → nicht persistierbar, kein harter Fehler */
  }
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
