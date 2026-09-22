import { useQuery } from '@tanstack/react-query';
import { ladeModulZaehler } from '../api/modulZaehler';
import { EINSATZ_KEYS, einsatzKeys, type EinsatzKey } from '../api/queryKeys';
import type { BenutzerAnzeige, ModulOverrides, ModulZaehler } from '../api/types';
import {
  istModulGesperrt,
  istModulSichtbar,
  modulRegistry,
  type ModulZaehlerQuelle,
} from './modulRegistry';

export interface ModulZaehlerWert {
  wert: number;
  /** Vollständige, fachliche Bedeutung für Tooltip und Accessible Name. */
  beschreibung: string;
}

export type ModulZaehlerMap = Partial<Record<ModulZaehlerQuelle, ModulZaehlerWert>>;

interface Args {
  einsatzId: number;
  benutzer: BenutzerAnzeige | null;
  overrides?: ModulOverrides;
}

function plural(anzahl: number, singular: string, pluralText: string): string {
  return `${anzahl} ${anzahl === 1 ? singular : pluralText}`;
}

type Antwort<Q extends ModulZaehlerQuelle> = NonNullable<ModulZaehler[Q]>;

/**
 * Serverfeld → Zahl + Bedeutung, je Quelle (LFH-612).
 *
 * WAS gezählt wird, entscheidet der Server (`src/einsatz/zaehler.rs`); hier steht nur, wie
 * es heißt. Die vier Kommunikations-Wortlaute sind byte-gleich zum Stand vor LFH-612, als
 * der Browser sie aus vollen Listen rechnete — Tooltip und zugänglicher Name ändern sich
 * durch den Umzug nicht.
 *
 * Ein `Record` über das String-Union der Quellen: eine neue Quelle ohne Abbildung bricht den
 * Typcheck, statt still ohne Zähler zu bleiben.
 */
const ABBILDUNG: { [Q in ModulZaehlerQuelle]: (z: Antwort<Q>) => ModulZaehlerWert } = {
  etb: ({ gesamt }) => ({
    wert: gesamt,
    beschreibung: `${plural(gesamt, 'Eintrag', 'Einträge')} im Einsatztagebuch`,
  }),
  personen: ({ gesamt }) => ({
    wert: gesamt,
    beschreibung: plural(gesamt, 'betroffene Person', 'Betroffene'),
  }),
  einheiten: ({ gesamt }) => ({
    wert: gesamt,
    beschreibung: plural(gesamt, 'Einheit', 'Einheiten'),
  }),
  einsatzabschnitte: ({ gesamt }) => ({
    wert: gesamt,
    beschreibung: plural(gesamt, 'Einsatzabschnitt', 'Einsatzabschnitte'),
  }),
  meldungen: ({ offen, ungesehen }) => ({
    wert: offen,
    beschreibung: `${plural(offen, 'offene Meldung', 'offene Meldungen')}, davon ${plural(ungesehen, 'ungesehen', 'ungesehen')}`,
  }),
  auftraege: ({ offen, ueberfaellig }) => ({
    wert: offen,
    beschreibung: `${plural(offen, 'offener Auftrag', 'offene Aufträge')}, davon ${plural(ueberfaellig, 'überfällig', 'überfällig')}`,
  }),
  erinnerungen: ({ faellig }) => ({
    wert: faellig,
    beschreibung: plural(faellig, 'fällige Erinnerung', 'fällige Erinnerungen'),
  }),
  chat: ({ ungelesen }) => ({
    wert: ungelesen,
    beschreibung: plural(ungelesen, 'ungelesene Chat-Nachricht', 'ungelesene Chat-Nachrichten'),
  }),
};

/** Alle Quellen, die der Server zählt — die Schlüssel der Abbildung, nicht eine zweite Liste. */
export const ZAEHLER_QUELLEN = Object.keys(ABBILDUNG) as ModulZaehlerQuelle[];

/**
 * Die Listen-Keys der gezählten Module. Wer einen davon invalidiert, verändert eine gezählte
 * Menge und muss den Modulzähler mit invalidieren — `queryKeys.test.ts` prüft das gegen
 * {@link EINSATZ_STREAM_EVENTS}. Hier und nicht im Test, damit eine neue Quelle ohne
 * Listen-Key den Typcheck bricht.
 */
export const ZAEHLER_LISTEN_KEYS: Record<ModulZaehlerQuelle, EinsatzKey> = {
  etb: EINSATZ_KEYS.etb,
  personen: EINSATZ_KEYS.personen,
  einheiten: EINSATZ_KEYS.einheiten,
  einsatzabschnitte: EINSATZ_KEYS.abschnitte,
  meldungen: EINSATZ_KEYS.meldungen,
  auftraege: EINSATZ_KEYS.auftraege,
  erinnerungen: EINSATZ_KEYS.erinnerungen,
  chat: EINSATZ_KEYS.chatKanaele,
};

/** Bildet die Serverantwort auf die Anzeige ab. Ein fehlendes Feld (Modul nicht erlaubt)
 *  bleibt fehlend — es wird nie zu 0. */
export function bildeZaehler(antwort: ModulZaehler): ModulZaehlerMap {
  const karte: ModulZaehlerMap = {};
  for (const quelle of ZAEHLER_QUELLEN) {
    const feld = antwort[quelle];
    if (feld == null) continue;
    karte[quelle] = (ABBILDUNG[quelle] as (z: typeof feld) => ModulZaehlerWert)(feld);
  }
  return karte;
}

/**
 * Ob der Rahmen den Zähler einer Quelle zeigen darf: nur an einem sichtbaren UND freien
 * Modul. Das Laden filtert seit LFH-612 der Server (ein nicht erlaubtes Modul fehlt in der
 * Antwort, dort mit den Org-Vorgaben, die der Client nicht kennt); diese Prüfung hält die
 * Anzeige zusätzlich an dieselbe Sicht wie die Navigation — ein Modul, das der Rahmen nicht
 * zeigt, zeigt auch keine Zahl.
 */
export function darfZaehlerZeigen(
  quelle: ModulZaehlerQuelle,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
): boolean {
  const modul = modulRegistry.find((eintrag) => eintrag.zaehlerQuelle === quelle);
  return Boolean(
    modul && istModulSichtbar(modul, overrides) && !istModulGesperrt(modul, benutzer, overrides),
  );
}

/** Die Zähler des Einsatz-Navigationsrahmens — EINE Abfrage, keine Modullisten (LFH-612). */
export function useModulZaehler({ einsatzId, benutzer, overrides }: Args): ModulZaehlerMap {
  const zaehler = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
    enabled: Number.isFinite(einsatzId),
  });
  if (!zaehler.isSuccess) return {};
  const karte = bildeZaehler(zaehler.data);
  for (const quelle of ZAEHLER_QUELLEN) {
    if (!darfZaehlerZeigen(quelle, benutzer, overrides)) delete karte[quelle];
  }
  return karte;
}
