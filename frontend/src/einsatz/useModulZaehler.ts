import { useQuery } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { listeAbloesungen } from '../api/abloesungen';
import { ladeBetreuung } from '../api/betreuung';
import { ladeEvakuierung } from '../api/evakuierung';
import { ladeModulZaehler } from '../api/modulZaehler';
import { wetterAbfrage } from '../api/wetter';
import { EINSATZ_KEYS, einsatzKeys, type EinsatzKey } from '../api/queryKeys';
import type {
  Abloesung,
  Betreuungsstelle,
  Evakuierungsbezirk,
  ModulFreigaben,
  ModulZaehler,
} from '../api/types';
import { countFaellige } from '../abloesung/einstufung';
import { useEinstufungsUhr } from '../abloesung/useUhr';
import { istAktiverBezirk } from '../betreuung/evakuierungKennzahl';
import { unwetterLage } from '../wetter/unwetter';
import { useUnwetterUhr } from '../wetter/useUnwetterUhr';
import { anzahl } from '../anzeige/anzahl';
import { modulRegistry, type ModulZaehlerQuelle, type ServerZaehlerQuelle } from './modulRegistry';

export interface ModulZaehlerWert {
  wert: number;
  /** Vollständige, fachliche Bedeutung für Tooltip und Accessible Name. */
  beschreibung: string;
}

export type ModulZaehlerMap = Partial<Record<ModulZaehlerQuelle, ModulZaehlerWert>>;

interface Args {
  einsatzId: number;
  freigaben?: ModulFreigaben;
}

type Antwort<Q extends ServerZaehlerQuelle> = NonNullable<ModulZaehler[Q]>;

/**
 * Serverfeld → Zahl + Bedeutung je Quelle. WAS gezählt wird, entscheidet der Server
 * (`src/einsatz/zaehler.rs`); hier steht nur, wie es heißt. Ein `Record` über die Quellen: eine
 * neue Quelle ohne Abbildung bricht den Typcheck.
 */
const ABBILDUNG: { [Q in ServerZaehlerQuelle]: (z: Antwort<Q>) => ModulZaehlerWert } = {
  etb: ({ gesamt }) => ({
    wert: gesamt,
    beschreibung: `${anzahl(gesamt, 'Eintrag', 'Einträge')} im Einsatztagebuch`,
  }),
  personen: ({ gesamt }) => ({
    wert: gesamt,
    beschreibung: anzahl(gesamt, 'betroffene Person', 'Betroffene'),
  }),
  einheiten: ({ gesamt }) => ({
    wert: gesamt,
    beschreibung: anzahl(gesamt, 'Einheit', 'Einheiten'),
  }),
  einsatzabschnitte: ({ gesamt }) => ({
    wert: gesamt,
    beschreibung: anzahl(gesamt, 'Einsatzabschnitt', 'Einsatzabschnitte'),
  }),
  meldungen: ({ offen, ungesehen }) => ({
    wert: offen,
    beschreibung: `${anzahl(offen, 'offene Meldung', 'offene Meldungen')}, davon ${anzahl(ungesehen, 'ungesehen', 'ungesehen')}`,
  }),
  auftraege: ({ offen, ueberfaellig }) => ({
    wert: offen,
    beschreibung: `${anzahl(offen, 'offener Auftrag', 'offene Aufträge')}, davon ${anzahl(ueberfaellig, 'überfällig', 'überfällig')}`,
  }),
  erinnerungen: ({ faellig }) => ({
    wert: faellig,
    beschreibung: anzahl(faellig, 'fällige Erinnerung', 'fällige Erinnerungen'),
  }),
  chat: ({ ungelesen }) => ({
    wert: ungelesen,
    beschreibung: anzahl(ungelesen, 'ungelesene Chat-Nachricht', 'ungelesene Chat-Nachrichten'),
  }),
  dokumente: ({ gesamt }) => ({
    wert: gesamt,
    beschreibung: anzahl(gesamt, 'abgelegtes Dokument', 'abgelegte Dokumente'),
  }),
  lagemeldungen: ({ neu }) => ({
    wert: neu,
    beschreibung: anzahl(neu, 'neue Lagemeldung', 'neue Lagemeldungen'),
  }),
  nachforderungen: ({ offen, unterwegs }) => ({
    wert: offen,
    beschreibung: `${anzahl(offen, 'offene Nachforderung', 'offene Nachforderungen')}, davon ${unterwegs} unterwegs`,
  }),
};

/** Alle Quellen, die der Server zählt — die Schlüssel der Abbildung, nicht eine zweite Liste. */
export const ZAEHLER_QUELLEN = Object.keys(ABBILDUNG) as ServerZaehlerQuelle[];

/**
 * Die Listen-Keys der gezählten Module: wer einen invalidiert, verändert eine gezählte Menge und
 * muss den Modulzähler mit invalidieren (`queryKeys.test.ts` prüft das). Hier, damit eine neue
 * Quelle ohne Listen-Key den Typcheck bricht.
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
  dokumente: EINSATZ_KEYS.dokumente,
  lagemeldungen: EINSATZ_KEYS.lagemeldungen,
  nachforderungen: EINSATZ_KEYS.nachforderungen,
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

// Die Zähler, die der Browser selbst rechnet — nicht in der Serverantwort und damit nicht in
// `ZAEHLER_QUELLEN`/`ZAEHLER_LISTEN_KEYS`: ihre Frische hängt an der eigenen Modulliste.

/** Schichten in der Vorwarnzeit oder überfällig — was jetzt Handlung braucht. */
export function berechneAbloesungZaehler(
  abloesungen: readonly Abloesung[],
  jetzt: Dayjs,
): ModulZaehlerWert {
  const faellig = countFaellige(abloesungen, jetzt);
  return {
    wert: faellig,
    beschreibung: `${anzahl(faellig, 'Ablösung', 'Ablösungen')} fällig oder in den nächsten 30 min`,
  };
}

/**
 * Aktive Evakuierungsbezirke; „aktiv" steht EINMAL in `betreuung/evakuierungKennzahl.ts`.
 * Browser-Zähler, weil Seite und Kennzahl dieselbe Übersicht ohnehin laden.
 */
export function berechneEvakuierungZaehler(
  bezirke: ReadonlyArray<Pick<Evakuierungsbezirk, 'raeumung' | 'storniert_at'>>,
): ModulZaehlerWert {
  const aktiv = bezirke.filter(istAktiverBezirk).length;
  return {
    wert: aktiv,
    beschreibung: anzahl(aktiv, 'aktiver Evakuierungsbezirk', 'aktive Evakuierungsbezirke'),
  };
}

/**
 * Betreuungsstellen in Betrieb (LLH-1034): vorbereitete und geschlossene zählen nicht, stornierte
 * liefert die Übersicht gar nicht. Browser-Zähler wie {@link berechneEvakuierungZaehler}.
 */
export function berechneBetreuungZaehler(
  stellen: ReadonlyArray<Pick<Betreuungsstelle, 'status' | 'storniert_at'>>,
): ModulZaehlerWert {
  const inBetrieb = stellen.filter((s) => s.status === 'in_betrieb' && !s.storniert_at).length;
  return {
    wert: inBetrieb,
    beschreibung: anzahl(inBetrieb, 'Betreuungsstelle in Betrieb', 'Betreuungsstellen in Betrieb'),
  };
}

/**
 * Gültige Unwetterwarnungen (schwer/extrem) am Einsatzort, gilt jetzt und angekündigt (LFH-663,
 * `openspec/changes/archive/2026-10-01-lfh-663-unwetterwarnung-alarmbudget/design.md` D7). Was „Unwetter" heißt,
 * steht EINMAL in `wetter/unwetter.ts`. Ohne verwertbaren Stand `undefined`: keine Zahl, auch
 * keine 0.
 */
export function berechneUnwetterZaehler(
  warnungen: Parameters<typeof unwetterLage>[0],
  jetzt: number,
): ModulZaehlerWert | undefined {
  const lage = unwetterLage(warnungen, jetzt);
  if (!lage) return undefined;
  const wert = lage.giltJetzt.length + lage.angekuendigt.length;
  const davon =
    lage.angekuendigt.length > 0 ? `, davon ${lage.angekuendigt.length} angekündigt` : '';
  return {
    wert,
    beschreibung: `${anzahl(wert, 'Unwetterwarnung', 'Unwetterwarnungen')} für den Einsatzort${davon}`,
  };
}

/**
 * Ob der Rahmen den Zähler einer Quelle zeigen darf: nur an einem sichtbaren UND freien Modul,
 * nach den Freigaben des Servers (LFH-669). Das Laden filtert der Server (ein nicht erlaubtes
 * Modul fehlt); diese Prüfung hält die Anzeige an dieselbe Sicht wie die Navigation. Für die
 * Browser-Zähler ist sie zugleich das Ladegate: kein 403-Rauschen, kein Seitenkanal — deshalb
 * geben unbekannte Freigaben nichts frei.
 */
export function darfZaehlerZeigen(quelle: ModulZaehlerQuelle, freigaben?: ModulFreigaben): boolean {
  const modul = modulRegistry.find((eintrag) => eintrag.zaehlerQuelle === quelle);
  const freigabe = modul ? freigaben?.[modul.key] : undefined;
  return Boolean(freigabe?.sichtbar && freigabe.zugriff);
}

/**
 * Die Zähler des Einsatz-Navigationsrahmens: EINE Serverabfrage für die Serverquellen, dazu die
 * Browser-Zähler aus ihren eigenen Modullisten.
 */
export function useModulZaehler({ einsatzId, freigaben }: Args): ModulZaehlerMap {
  const abloesungAktiv = darfZaehlerZeigen('abloesung', freigaben);
  const betreuungAktiv = darfZaehlerZeigen('betreuung', freigaben);
  const evakuierungAktiv = darfZaehlerZeigen('evakuierung', freigaben);
  // Das Wetter nur bei bekannter Freigabe (LFH-663, LFH-669): unbekannte Freigaben geben
  // nichts frei, ein ausgeblendetes Modul bekommt keine Anfrage.
  const wetterAktiv = darfZaehlerZeigen('wetter-pegel', freigaben);

  const zaehler = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
  });
  const abloesungen = useQuery({
    queryKey: einsatzKeys.abloesungListe(einsatzId, 'laufend'),
    queryFn: () => listeAbloesungen(einsatzId, 'laufend'),
    enabled: abloesungAktiv,
  });
  // Dieselbe Übersicht wie die Seite: ein Abruf, ein Cache-Fach.
  const betreuung = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
    enabled: betreuungAktiv,
  });
  // Dieselbe Übersicht wie Seite und Kennzahl „Evakuiert“ (LLH-1034).
  const evakuierung = useQuery({
    queryKey: einsatzKeys.evakuierung(einsatzId),
    queryFn: () => ladeEvakuierung(einsatzId),
    enabled: evakuierungAktiv,
  });
  // Dieselbe Abfrage wie Modulseite und Unwetterhinweis: ein Abruf je 5 min, ein Cache-Fach.
  const wetter = useQuery({ ...wetterAbfrage(einsatzId), enabled: wetterAktiv });
  // Eine abgelaufene Warnung fällt auch zwischen zwei Abrufen heraus.
  const wetterJetzt = useUnwetterUhr(wetterAktiv ? wetter.data?.warnungen : undefined);
  // Die Einstufung hängt an der Uhr: ohne Wecker bliebe der Zähler bei einer Schicht, die in die
  // Vorwarnzeit läuft, auf dem alten Stand.
  const jetzt = useEinstufungsUhr(abloesungAktiv ? abloesungen.data : undefined);

  const karte: ModulZaehlerMap = zaehler.isSuccess ? bildeZaehler(zaehler.data) : {};
  for (const quelle of ZAEHLER_QUELLEN) {
    if (!darfZaehlerZeigen(quelle, freigaben)) delete karte[quelle];
  }
  if (abloesungAktiv && abloesungen.isSuccess) {
    karte.abloesung = berechneAbloesungZaehler(abloesungen.data, jetzt);
  }
  if (betreuungAktiv && betreuung.isSuccess) {
    karte.betreuung = berechneBetreuungZaehler(betreuung.data.stellen);
  }
  if (evakuierungAktiv && evakuierung.isSuccess) {
    karte.evakuierung = berechneEvakuierungZaehler(evakuierung.data.bezirke);
  }
  if (wetterAktiv && wetter.isSuccess) {
    const unwetter = berechneUnwetterZaehler(wetter.data.warnungen, wetterJetzt);
    if (unwetter) karte['wetter-pegel'] = unwetter;
  }
  return karte;
}
