import { useQuery } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { listeAbloesungen } from '../api/abloesungen';
import { listeDokumente } from '../api/dokumente';
import { ladeModulZaehler } from '../api/modulZaehler';
import { EINSATZ_KEYS, einsatzKeys, type EinsatzKey } from '../api/queryKeys';
import type { Abloesung, BenutzerAnzeige, ModulOverrides, ModulZaehler } from '../api/types';
import { zaehleFaellige } from '../abloesung/einstufung';
import { useEinstufungsUhr } from '../abloesung/useUhr';
import {
  istModulGesperrt,
  istModulSichtbar,
  modulRegistry,
  type ModulZaehlerQuelle,
  type ServerZaehlerQuelle,
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

type Antwort<Q extends ServerZaehlerQuelle> = NonNullable<ModulZaehler[Q]>;

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
const ABBILDUNG: { [Q in ServerZaehlerQuelle]: (z: Antwort<Q>) => ModulZaehlerWert } = {
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
export const ZAEHLER_QUELLEN = Object.keys(ABBILDUNG) as ServerZaehlerQuelle[];

/**
 * Die Listen-Keys der gezählten Module. Wer einen davon invalidiert, verändert eine gezählte
 * Menge und muss den Modulzähler mit invalidieren — `queryKeys.test.ts` prüft das gegen
 * {@link EINSATZ_STREAM_EVENTS}. Hier und nicht im Test, damit eine neue Quelle ohne
 * Listen-Key den Typcheck bricht.
 */
export const ZAEHLER_LISTEN_KEYS: Record<ServerZaehlerQuelle, EinsatzKey> = {
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
 * Die zwei Zähler, die der Browser selbst rechnet (LFH-632, LFH-635) — sie stehen NICHT in
 * der Serverantwort und deshalb auch nicht in {@link ZAEHLER_QUELLEN}/{@link ZAEHLER_LISTEN_KEYS}:
 * ihre Frische hängt an der eigenen Modulliste, nicht am Modulzähler-Key.
 */
export function berechneDokumentZaehler(dokumente: readonly unknown[]): ModulZaehlerWert {
  const n = dokumente.length;
  return { wert: n, beschreibung: plural(n, 'abgelegtes Dokument', 'abgelegte Dokumente') };
}

/** LFH-635: Schichten in der Vorwarnzeit oder überfällig — was jetzt Handlung braucht. */
export function berechneAbloesungZaehler(
  abloesungen: readonly Abloesung[],
  jetzt: Dayjs,
): ModulZaehlerWert {
  const faellig = zaehleFaellige(abloesungen, jetzt);
  return {
    wert: faellig,
    beschreibung: `${plural(faellig, 'Ablösung', 'Ablösungen')} fällig oder in den nächsten 30 min`,
  };
}

/**
 * Ob der Rahmen den Zähler einer Quelle zeigen darf: nur an einem sichtbaren UND freien
 * Modul. Das Laden filtert seit LFH-612 der Server (ein nicht erlaubtes Modul fehlt in der
 * Antwort, dort mit den Org-Vorgaben, die der Client nicht kennt); diese Prüfung hält die
 * Anzeige zusätzlich an dieselbe Sicht wie die Navigation — ein Modul, das der Rahmen nicht
 * zeigt, zeigt auch keine Zahl. Für die zwei Browser-Zähler ist sie zugleich das Ladegate:
 * ein ausgeblendetes oder gesperrtes Modul erzeugt weder 403-Rauschen noch einen Seitenkanal.
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

/**
 * Die Zähler des Einsatz-Navigationsrahmens: EINE Serverabfrage für die acht Serverquellen
 * (LFH-612), dazu die zwei Browser-Zähler aus ihren eigenen Modullisten (LFH-632, LFH-635).
 */
export function useModulZaehler({ einsatzId, benutzer, overrides }: Args): ModulZaehlerMap {
  const gueltigerEinsatz = Number.isFinite(einsatzId);
  const dokumenteAktiv = gueltigerEinsatz && darfZaehlerZeigen('dokumente', benutzer, overrides);
  const abloesungAktiv = gueltigerEinsatz && darfZaehlerZeigen('abloesung', benutzer, overrides);

  const zaehler = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
    enabled: gueltigerEinsatz,
  });
  const dokumente = useQuery({
    queryKey: einsatzKeys.dokumente(einsatzId),
    queryFn: () => listeDokumente(einsatzId),
    enabled: dokumenteAktiv,
  });
  const abloesungen = useQuery({
    queryKey: einsatzKeys.abloesungListe(einsatzId, 'laufend'),
    queryFn: () => listeAbloesungen(einsatzId, 'laufend'),
    enabled: abloesungAktiv,
  });
  // Die Einstufung hängt an der Uhr, nicht nur am Abruf: ohne Wecker bliebe der Zähler bei
  // einer Schicht, die gerade in die Vorwarnzeit läuft, still auf dem alten Stand.
  const jetzt = useEinstufungsUhr(abloesungAktiv ? abloesungen.data : undefined);

  const karte: ModulZaehlerMap = zaehler.isSuccess ? bildeZaehler(zaehler.data) : {};
  for (const quelle of ZAEHLER_QUELLEN) {
    if (!darfZaehlerZeigen(quelle, benutzer, overrides)) delete karte[quelle];
  }
  if (dokumenteAktiv && dokumente.isSuccess) {
    karte.dokumente = berechneDokumentZaehler(dokumente.data);
  }
  if (abloesungAktiv && abloesungen.isSuccess) {
    karte.abloesung = berechneAbloesungZaehler(abloesungen.data, jetzt);
  }
  return karte;
}
