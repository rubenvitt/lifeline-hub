import { apiGet, apiSend } from './client';
import { einsatzKeys } from './queryKeys';
import type { PegelAnzeige, PegelVerlauf, PegelVorhersageAntwort } from './types';

/**
 * Maßgebliche Pegel eines Einsatzes. Alle drei Routen antworten mit der VOLLSTÄNDIGEN Liste in
 * Reihenfolge, je Eintrag mit der jüngsten Messung; die Mutationen setzen die Antwort deshalb
 * per `setQueryData` auf {@link einsatzKeys.pegel}.
 */

/** Eine Station, wie sie gewählt wird (Snapshot von Name und Gewässer zum Festlegen). */
export interface PegelEingabe {
  station_uuid: string;
  name: string;
  gewaesser?: string | null;
}

/** Höchstzahl maßgeblicher Pegel je Einsatz — dieselbe Grenze wie `PEGEL_MAX` im Backend. */
export const PEGEL_MAX = 5;

/**
 * Nachfrage-Takt: kein Live-Ereignis (die Messwerte ändern sich im 15-min-Raster der
 * Quelle), also alle 5 min — derselbe Wert wie die Cache-Frist im Backend.
 */
export const PEGEL_ABRUF_MS = 5 * 60_000;

export function listePegel(einsatzId: number): Promise<PegelAnzeige[]> {
  return apiGet<PegelAnzeige[]>(`/api/einsaetze/${einsatzId}/pegel`);
}

/** Ersetzt die Liste vollständig; die Reihenfolge ist die des Arrays (erster = Leitpegel). */
export function setzePegel(einsatzId: number, stationen: PegelEingabe[]): Promise<PegelAnzeige[]> {
  return apiSend<PegelAnzeige[]>(`/api/einsaetze/${einsatzId}/pegel`, 'PUT', { stationen });
}

/** Hängt eine Station hinten an; eine schon festgelegte bleibt unverändert (200, idempotent). */
export function fuegePegelHinzu(einsatzId: number, station: PegelEingabe): Promise<PegelAnzeige[]> {
  return apiSend<PegelAnzeige[]>(`/api/einsaetze/${einsatzId}/pegel`, 'POST', station);
}

/** Erwarteter Höchststand: Wert in cm, Zeitpunkt ISO-8601 (`toISOString()`). */
export interface PrognoseEingabe {
  hoechststand_cm: number;
  zeitpunkt: string;
}

/** Setzt die Prognose eines Pegels (überschreibt eine vorhandene); Antwort: die ganze Liste. */
export function setzePrognose(
  einsatzId: number,
  pegelId: number,
  prognose: PrognoseEingabe,
): Promise<PegelAnzeige[]> {
  return apiSend<PegelAnzeige[]>(
    `/api/einsaetze/${einsatzId}/pegel/${pegelId}/prognose`,
    'PUT',
    prognose,
  );
}

/** Löscht die Prognose eines Pegels (idempotent); Antwort: die ganze Liste. */
export function loeschePrognose(einsatzId: number, pegelId: number): Promise<PegelAnzeige[]> {
  return apiSend<PegelAnzeige[]>(`/api/einsaetze/${einsatzId}/pegel/${pegelId}/prognose`, 'DELETE');
}

/**
 * Vorschlag aus der PEGELONLINE-Vorhersage-Reihe `WV`: höchster künftiger Wert. Ohne Reihe (die
 * meisten Stationen) fehlt `vorhersage`; das ist kein Fehler.
 */
export function ladeVorhersage(
  einsatzId: number,
  pegelId: number,
): Promise<PegelVorhersageAntwort> {
  return apiGet<PegelVorhersageAntwort>(`/api/einsaetze/${einsatzId}/pegel/${pegelId}/vorhersage`);
}

/**
 * Einmalige Nachfrage, wenn einem Eintrag die Messung fehlt. PUT und POST warten nie auf
 * PEGELONLINE: eine neu festgelegte Station kommt ohne Messung zurück, der Abruf läuft im
 * Hintergrund. Ohne Nachfrage stünde „Stand unbekannt“ bis zum nächsten 5-min-Takt.
 */
export const PEGEL_NACHFRAGE_MS = 10_000;

/**
 * Signatur der fehlenden Messungen: die uuids ohne `messung`, sortiert. `null`, wenn keine
 * fehlt. Rein.
 */
export function fehlendeSignatur(daten: readonly PegelAnzeige[] | undefined): string | null {
  const fehlend = (daten ?? []).filter((p) => !p.messung).map((p) => p.station_uuid);
  return fehlend.length > 0 ? fehlend.sort().join(',') : null;
}

/** Wann eine Lücke zuerst gesehen wurde: ihre Signatur und der Datenstand (`dataUpdatedAt`).
 *  Nicht exportiert: kein Wire-Typ, nur das Gedächtnis der Nachfrage-Regel. */
interface LueckenVermerk {
  signatur: string;
  bei: number;
}

/**
 * Nächster Abruf-Abstand als reine Funktion von Daten, Datenstand und Vermerk.
 *
 * Kurz ({@link PEGEL_NACHFRAGE_MS}) genau für den Datenstand, an dem eine Lücke ZUERST
 * auftauchte; jeder spätere Datenstand mit derselben Lücke fällt auf den 5-min-Takt zurück,
 * keine Schleife. Eine NEUE Lücke bekommt ihre eigene Nachfrage.
 *
 * IDEMPOTENT je Datenstand, und das trägt: TanStack wertet `refetchInterval` bei JEDEM Render
 * und jeder Zustandsänderung der Abfrage aus. Eine Funktion, die beim ersten Aufruf „kurz“
 * vermerkt und beim zweiten „erledigt“ antwortet, setzte das Intervall zurück, bevor es feuert.
 */
export function naechsterPegelAbruf(
  daten: readonly PegelAnzeige[] | undefined,
  datenstand: number,
  vermerk: LueckenVermerk | null,
): { ms: number; vermerk: LueckenVermerk | null } {
  const signatur = fehlendeSignatur(daten);
  if (signatur == null) return { ms: PEGEL_ABRUF_MS, vermerk: null };
  const aktuell =
    vermerk && vermerk.signatur === signatur ? vermerk : { signatur, bei: datenstand };
  return {
    ms: aktuell.bei === datenstand ? PEGEL_NACHFRAGE_MS : PEGEL_ABRUF_MS,
    vermerk: aktuell,
  };
}

/**
 * Vermerk je Cache-Eintrag, am `Query`-Objekt statt in einer Komponente: alle Leser teilen den
 * Eintrag, und eine neu montierte Komponente darf die Nachfrage nicht erneut auslösen. Die
 * WeakMap räumt sich mit dem Eintrag; das Intervall gehört TanStack.
 */
const luecken = new WeakMap<object, LueckenVermerk | null>();

function refetchIntervall(query: {
  state: { data?: PegelAnzeige[]; dataUpdatedAt: number };
}): number {
  const { ms, vermerk } = naechsterPegelAbruf(
    query.state.data,
    query.state.dataUpdatedAt,
    luecken.get(query) ?? null,
  );
  luecken.set(query, vermerk);
  return ms;
}

/**
 * Die EINE Abfrage-Konfiguration für alle Leser (Dashboard, Überblick, Einstellungen,
 * Lagekarte): gleicher Key, gleicher Takt, sonst zöge der Leser mit dem kürzesten Intervall die
 * anderen still mit. 5 min, plus einmalige Nachfrage bei fehlender Messung.
 */
export function pegelAbfrage(einsatzId: number) {
  return {
    queryKey: einsatzKeys.pegel(einsatzId),
    queryFn: () => listePegel(einsatzId),
    refetchInterval: refetchIntervall,
  };
}

/**
 * Schlüssel, unter dem alle Schreibwege auf die Pegel-Liste eines Einsatzes nacheinander
 * laufen (TanStack `scope`): ein POST und ein PUT gleichzeitig kämen in Ankunftsreihenfolge
 * an, und der PUT mit der Altliste nähme die gerade hinzugefügte Station wieder heraus.
 */
export function pegelSchreibScope(einsatzId: number) {
  return { id: `pegel-schreiben-${einsatzId}` };
}

/**
 * 24-h-Verlauf aller festgelegten Pegel, in Pegel-Reihenfolge; eine Station ohne Stand kommt mit
 * leerer Reihe. Eigene Route, weil die Liste auch Dashboard und Überblick alle 5 min lesen, die
 * Reihe aber nur die Modulseite braucht.
 */
function ladeVerlauf(einsatzId: number): Promise<PegelVerlauf[]> {
  return apiGet<PegelVerlauf[]>(`/api/einsaetze/${einsatzId}/pegel/verlauf`);
}

/**
 * Abfrage des Verlaufs im 5-min-Takt. Liste und Verlauf sind ZWEI Anfragen, ein gemeinsamer
 * Stand ist nicht zugesichert. Die 10-s-Nachfrage der Liste hat der Verlauf nicht; die Seite
 * zieht ihn nach, wenn ein Wert ohne Reihe dasteht (`verlaufLuecke`).
 */
export function pegelVerlaufAbfrage(einsatzId: number) {
  return {
    queryKey: einsatzKeys.pegelVerlauf(einsatzId),
    queryFn: () => ladeVerlauf(einsatzId),
    refetchInterval: PEGEL_ABRUF_MS,
  };
}
