import type { FreiesZeichenUpdate } from '../../api/types';

/**
 * „Zuletzt verwendete" taktische Zeichen (LFH-716, Kandidat aus LFH-344 · M62).
 *
 * **Warum `localStorage` und nicht der Ansichts-Konfig-Bag:** dieselbe Begründung wie bei
 * dem gespeicherten Klappzustand der Leistenpaneele — welche Zeichen ICH zuletzt gesetzt habe, ist eine persönliche
 * Bediengewohnheit und keine geteilte Ansichtseigenschaft. Eine Ansicht wird geteilt, meine
 * letzten sechs Griffe gehen niemanden sonst etwas an.
 *
 * **Geschrieben wird beim PLATZIEREN, nicht beim Ändern des Entwurfs.** Der Picker ist ein
 * kontrollierter Werteditor: jeder Klick auf eine Kachel meldet eine neue Spec. Hinge das
 * Merken daran, stünden in der Leiste sechs Zwischenstände eines einzigen Zeichens statt
 * sechs benutzter Zeichen. Deshalb ruft die Platzier-Stelle {@link merkeZuletztVerwendet},
 * nicht der Picker.
 */
const SPEICHER_SCHLUESSEL = 'lfh:lagekarte:zeichen-zuletzt';

/** Sechs — so viele Kacheln stehen in einer Leiste von ~390 px nebeneinander, ohne dass die
 *  Leiste selbst scrollen muss. Mehr wäre kein Schnellzugriff mehr, sondern ein zweiter
 *  Katalog neben dem Katalog. */
export const ZULETZT_MAX = 6;

/** Die sieben Felder, die das ZEICHEN ausmachen — in fester Reihenfolge, weil aus genau
 *  dieser Liste sowohl der gespeicherte Eintrag als auch sein Dublettenschlüssel entsteht. */
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
 * **Zwei Felder fallen bewusst weg.** `label` ist der Name EINER Platzierung — ihn beim
 * Wiederverwenden mitzubringen legte einen zweiten „EA Nord" an, und als Teil des
 * Dublettenschlüssels machte er aus „Person, Führungskraft" zwei Einträge, nur weil die
 * zweite anders heißt. `ansicht_id` bindet an die beim Platzieren aktive Kartenansicht; ein
 * mitgeschleppter Altwert legte das Zeichen auf einer fremden Ansicht ab.
 *
 * **Und es wird gepflückt, nicht kopiert-und-gelöscht:** an der Platzier-Stelle liegt ein
 * `NeuesFreiesZeichen` MIT lat/lon. Ein durchgereichtes Koordinatenpaar machte jede
 * Platzierung zu einem eigenen Schlüssel — „ohne Dubletten" stürbe lautlos, ohne roten Test.
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

/** Ein Eintrag ohne Grundzeichen ist kein Zeichen — er wird EINZELN verworfen, der Rest der
 *  Liste bleibt. (Ein ganz kaputter Speicherinhalt fällt eine Ebene höher weg.) */
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
  // Das Jüngste nach vorn, das gleiche Zeichen weiter hinten fällt beim Entduplizieren weg
  // — ein erneut benutztes Zeichen WANDERT also, statt ein zweites Mal dazustehen.
  const liste = entdupliziere([neu, ...leseZuletztVerwendet()]);
  try {
    localStorage.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(liste));
  } catch {
    /* nicht verfügbar → nicht persistierbar, kein harter Fehler */
  }
  benachrichtige();
}

/**
 * Die Leiste im Picker muss sich nach einer Platzierung erneuern — geschrieben wird aber
 * anderswo (siehe Kopfkommentar), und der Picker bleibt die ganze Sitzung montiert. Ohne
 * dieses Signal zeigte er bis zum nächsten Remount den Stand vom Sitzungsbeginn.
 *
 * Bewusst KEIN gecachter Schnappschuss für `useSyncExternalStore`: der müsste zwischen
 * Tests von Hand zurückgesetzt werden und wäre eine zweite Wahrheit neben dem Speicher.
 * Der Abonnent liest schlicht neu.
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
