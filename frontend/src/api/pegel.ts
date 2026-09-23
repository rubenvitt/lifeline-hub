import { apiGet, apiSend } from './client';
import { einsatzKeys } from './queryKeys';
import type { PegelAnzeige, PegelVerlauf, PegelVorhersageAntwort } from './types';

/**
 * Maßgebliche Pegel eines Einsatzes (LFH-606).
 *
 * Alle drei Routen antworten mit der VOLLSTÄNDIGEN Liste in Reihenfolge, je Eintrag mit der
 * jüngsten Messung. Die Mutationen setzen die Antwort deshalb per `setQueryData` auf
 * {@link einsatzKeys.pegel}, statt eine Invalidierung mit zweitem Abruf auszulösen.
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

/** Erwarteter Höchststand (LFH-628): Wert in cm, Zeitpunkt ISO-8601 (`toISOString()`). */
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
 * Vorschlag aus der PEGELONLINE-Vorhersage-Reihe `WV` (LFH-628): höchster künftiger Wert.
 * Ohne Reihe (die meisten Stationen) fehlt `vorhersage`; das ist kein Fehler.
 */
export function ladeVorhersage(
  einsatzId: number,
  pegelId: number,
): Promise<PegelVorhersageAntwort> {
  return apiGet<PegelVorhersageAntwort>(`/api/einsaetze/${einsatzId}/pegel/${pegelId}/vorhersage`);
}

/**
 * Einmalige Nachfrage, wenn einem Eintrag die Messung fehlt (LFH-606, Prüfliste O2).
 *
 * PUT und POST warten nie auf PEGELONLINE: eine neu festgelegte, noch nicht gecachte
 * Station kommt ohne Messung zurück, der Abruf läuft im Hintergrund (Backend
 * `Modus::NurCache`). Ohne Nachfrage stünde die Kennzahl bis zum nächsten 5-min-Takt auf
 * „Stand unbekannt“, obwohl die Messung Sekunden später im Cache liegt.
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
 * auftauchte; jeder spätere Datenstand mit derselben Lücke (die Nachfrage kam, die Messung
 * fehlt weiter) fällt auf den 5-min-Takt zurück — keine Schleife. Eine NEUE Lücke (andere
 * Station) bekommt ihre eigene Nachfrage.
 *
 * IDEMPOTENT je Datenstand, und das ist tragend: TanStack wertet `refetchInterval` nicht nur
 * nach einem Abruf aus, sondern bei JEDEM Render (`setOptions`) und jeder Zustandsänderung
 * der Abfrage (`onQueryUpdate` → `#updateTimers`). Eine Funktion, die beim ersten Aufruf
 * „jetzt kurz“ vermerkt und beim zweiten „schon erledigt“ antwortet, setzte das kurze
 * Intervall sofort wieder auf 5 min zurück, bevor es feuert. Rein.
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
 * Vermerk je Cache-Eintrag. Am `Query`-Objekt statt in einer Komponente: alle Leser teilen
 * den Eintrag (Dashboard, Überblick, Einstellungen, Karte), und eine Komponente, die neu
 * montiert, darf die Nachfrage nicht erneut auslösen. Die WeakMap räumt sich mit dem
 * Eintrag; einen eigenen Timer gibt es nicht — das Intervall gehört TanStack und endet mit
 * dem letzten Beobachter.
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
 * Lagekarte): gleicher Key, gleicher Takt — sonst zöge der Leser mit dem kürzesten Intervall
 * die anderen mit, ohne dass es irgendwo stünde. Der Takt ist 5 min, mit einer einmaligen
 * kurzen Nachfrage bei fehlender Messung ({@link naechsterPegelAbruf}).
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
 * 24-h-Verlauf aller festgelegten Pegel (LFH-633), in Pegel-Reihenfolge. Eine Station ohne
 * Stand kommt mit leerer Reihe. Eigene Route statt Feld in der Liste: die Liste lesen auch
 * Dashboard und Überblick alle 5 min, die Reihe braucht nur die Modulseite.
 */
export function ladeVerlauf(einsatzId: number): Promise<PegelVerlauf[]> {
  return apiGet<PegelVerlauf[]>(`/api/einsaetze/${einsatzId}/pegel/verlauf`);
}

/** Abfrage des Verlaufs — derselbe 5-min-Takt wie die Liste, damit Wert und Linie EIN Stand
 *  bleiben (beide lesen denselben Cache-Eintrag im Backend). */
export function pegelVerlaufAbfrage(einsatzId: number) {
  return {
    queryKey: einsatzKeys.pegelVerlauf(einsatzId),
    queryFn: () => ladeVerlauf(einsatzId),
    refetchInterval: PEGEL_ABRUF_MS,
  };
}
