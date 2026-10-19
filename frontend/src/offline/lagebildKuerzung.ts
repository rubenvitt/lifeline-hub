import { EINSATZ_KEYS } from '../api/queryKeys';
import type { Person, PersonAuswahl } from '../api/types';

/**
 * Datensparsamkeit an der Grenze zur Platte (LFH-1095, design.md D1/D2): was eine Ansicht ohne
 * Netz nicht braucht, geht nicht auf das Gerät. Fristen und Löschen greifen nur bei laufender
 * App; gegen ein ausgeschaltetes Gerät ohne Geräteverschlüsselung hilft nur, was nie dort lag.
 *
 * Gekürzt wird beim Speichern (Live und Vorrat) und vor dem `hydrate` (ein Stand aus der Zeit
 * davor). Der Live-Cache bleibt unberührt: ein Tab, dem nur das Netz wegfällt, zeigt weiter alles.
 */

/**
 * Jedes Feld der Personenantwort, eingeordnet. Ein neues Feld im generierten Typ bricht den
 * Typcheck, bis es hier steht; kopiert wird nur `behalten` (Positivliste). Ausgelassen sind die
 * Freitexte und der Fundort samt Koordinate (Entscheidung Ruben 09.10.2026: eine
 * Fundkoordinate ist oft die Wohnadresse). Sichtung, Verbleib und UHS/Platz bleiben: die UHS
 * arbeitet ohne Netz mit ihnen.
 */
export const PERSON_AUF_DER_PLATTE = {
  id: 'behalten',
  einsatz_id: 'behalten',
  registrier_nr: 'behalten',
  status: 'behalten',
  name: 'behalten',
  vorname: 'behalten',
  geschlecht: 'behalten',
  geburtsdatum: 'behalten',
  alter_geschaetzt: 'behalten',
  herkunft_adresse: 'auslassen',
  antreff_ort: 'auslassen',
  melder_kontakt: 'auslassen',
  notiz: 'auslassen',
  erfasst_at: 'behalten',
  erfasst_von: 'behalten',
  geaendert_at: 'behalten',
  geaendert_von: 'behalten',
  storniert_at: 'behalten',
  aktuelle_sichtung: 'behalten',
  aktuelle_sichtung_at: 'behalten',
  aktueller_verbleib: 'behalten',
  aktuelle_uhs_id: 'behalten',
  aktueller_platz_id: 'behalten',
  zustand: 'auslassen',
  antreff_lat: 'auslassen',
  antreff_lon: 'auslassen',
  vermisst_seit: 'behalten',
  aktuelle_verbleib_art: 'behalten',
  aktuelles_verbleib_ziel: 'behalten',
  aktueller_verbleib_status: 'behalten',
  aktuelle_verbleib_betreuungsstelle_id: 'behalten',
  // LLH-1326 (Change y18v58dt-pat-kern, design.md D9): die Kontamination ist eine
  // Statuskategorie wie die Sichtung und warnt die Kräfte auch ohne Netz; die PAT-Nummer
  // verknüpft die Person mit der Papiertasche und bleibt vom Gerät fern.
  pat_nummer: 'auslassen',
  kontamination: 'behalten',
  // LLH-1325 (design.md D9): Priorität und Art ordnen den Abtransport auch ohne Netz; die
  // Fachrichtung ist diagnosenah, die Zeit des Stands braucht ohne Netz niemand.
  transport_prioritaet: 'behalten',
  transport_art: 'behalten',
  transport_fachrichtung: 'auslassen',
  transport_at: 'auslassen',
} as const satisfies Record<keyof Person, 'behalten' | 'auslassen'>;

/**
 * Die Personenauswahl (LFH-940) hält Sprungpalette und Auswahlfelder ohne Netz am Leben: Nummer,
 * Name und Status bleiben. Die PAT-Nummer bleibt draußen wie in der Vollliste (LLH-1326, D9);
 * ohne Netz findet die Palette eine Person darum nicht über sie (Spec `sprungpalette`).
 */
export const PERSONENAUSWAHL_AUF_DER_PLATTE = {
  id: 'behalten',
  registrier_nr: 'behalten',
  status: 'behalten',
  name: 'behalten',
  vorname: 'behalten',
  pat_nummer: 'auslassen',
} as const satisfies Record<keyof PersonAuswahl, 'behalten' | 'auslassen'>;

type PersonFeld = keyof typeof PERSON_AUF_DER_PLATTE;

const BEHALTEN = (Object.keys(PERSON_AUF_DER_PLATTE) as PersonFeld[]).filter(
  (f) => PERSON_AUF_DER_PLATTE[f] === 'behalten',
);
const AUSGELASSEN = (Object.keys(PERSON_AUF_DER_PLATTE) as PersonFeld[])
  .filter((f) => PERSON_AUF_DER_PLATTE[f] === 'auslassen')
  .sort();

const AUSWAHL_BEHALTEN = (
  Object.keys(PERSONENAUSWAHL_AUF_DER_PLATTE) as (keyof typeof PERSONENAUSWAHL_AUF_DER_PLATTE)[]
).filter((f) => PERSONENAUSWAHL_AUF_DER_PLATTE[f] === 'behalten');

/**
 * Marke am gekürzten Datensatz (D3): die Felder, die ohne Netz nicht geladen sind. Am Datensatz
 * statt an der Query, weil `setQueryData`-Updater neue Listen bauen, Datensätze aber per Spread
 * übernehmen. Der nächste Abruf mit Netz ersetzt die Liste, und die Marke ist weg.
 */
const MARKE = 'nicht_geladen';

function personKuerzen(p: unknown): unknown {
  if (p === null || typeof p !== 'object') return p;
  const quelle = p as Record<string, unknown>;
  const gekuerzt: Record<string, unknown> = {};
  for (const feld of BEHALTEN) if (feld in quelle) gekuerzt[feld] = quelle[feld];
  gekuerzt[MARKE] = [...AUSGELASSEN];
  return gekuerzt;
}

/** Ein Eintrag der Personenauswahl, nur mit den Feldern der Positivliste; ohne Marke, denn die
 *  Auswahl zeigt kein ausgelassenes Feld an. */
function auswahlKuerzen(p: unknown): unknown {
  if (p === null || typeof p !== 'object') return p;
  const quelle = p as Record<string, unknown>;
  const gekuerzt: Record<string, unknown> = {};
  for (const feld of AUSWAHL_BEHALTEN) if (feld in quelle) gekuerzt[feld] = quelle[feld];
  return gekuerzt;
}

/** Projektion je Prefix: die Vollliste der Personen und ihre Auswahl. */
const KUERZUNG: Partial<Record<string, (p: unknown) => unknown>> = {
  [EINSATZ_KEYS.personen]: personKuerzen,
  [EINSATZ_KEYS.personenAuswahl]: auswahlKuerzen,
};

/** Kürzt einen Eintrag des Lagebilds, falls sein Prefix eine Projektion hat; sonst derselbe
 *  Eintrag. Erzeugt neue Objekte, der Eingang bleibt unverändert. */
export function lagebildKuerzen<
  E extends { queryKey: readonly unknown[]; state: { data?: unknown } },
>(eintrag: E): E {
  const daten = eintrag.state.data;
  const kuerzen =
    typeof eintrag.queryKey[0] === 'string' ? KUERZUNG[eintrag.queryKey[0]] : undefined;
  if (!kuerzen || !Array.isArray(daten)) return eintrag;
  return { ...eintrag, state: { ...eintrag.state, data: daten.map(kuerzen) } };
}

/** Ist dieses Feld der Person ohne Netz nicht geladen? Dann ist es weder leer noch offen. */
export function nichtGeladen(p: object, feld: PersonFeld): boolean {
  const marke = (p as { [MARKE]?: unknown })[MARKE];
  return Array.isArray(marke) && marke.includes(feld);
}
