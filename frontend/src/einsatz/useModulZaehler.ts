import { useQuery } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { listeAbloesungen } from '../api/abloesungen';
import { listeAuftraege } from '../api/auftraege';
import { ladeBetreuung } from '../api/betreuung';
import { listeErinnerungen } from '../api/erinnerungen';
import { listeKanaele } from '../api/chat';
import { listeDokumente } from '../api/dokumente';
import { listeMeldungen } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type {
  Abloesung,
  Auftrag,
  BenutzerAnzeige,
  ChatKanal,
  Erinnerung,
  Evakuierungsbezirk,
  Meldung,
  ModulOverrides,
} from '../api/types';
import { zaehleFaellige } from '../abloesung/einstufung';
import { useEinstufungsUhr } from '../abloesung/useUhr';
import { istAktiverBezirk } from '../betreuung/evakuierungKennzahl';
import { AUFTRAG_STATUS, istAbgeschlossen } from '../kommunikation';
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

export function berechneMeldungsZaehler(
  meldungen: Array<Pick<Meldung, 'ist_offen' | 'status'>>,
): ModulZaehlerWert {
  const offen = meldungen.filter((meldung) => meldung.ist_offen).length;
  const ungesehen = meldungen.filter(
    (meldung) => meldung.ist_offen && meldung.status === 'neu',
  ).length;
  return {
    wert: offen,
    beschreibung: `${plural(offen, 'offene Meldung', 'offene Meldungen')}, davon ${plural(ungesehen, 'ungesehen', 'ungesehen')}`,
  };
}

export function berechneAuftragsZaehler(
  auftraege: Array<Pick<Auftrag, 'bearbeitungsstatus' | 'ist_ueberfaellig'>>,
): ModulZaehlerWert {
  const offen = auftraege.filter(
    (auftrag) => !istAbgeschlossen(AUFTRAG_STATUS[auftrag.bearbeitungsstatus]?.phase ?? 'offen'),
  ).length;
  const ueberfaellig = auftraege.filter(
    (auftrag) =>
      auftrag.ist_ueberfaellig &&
      !istAbgeschlossen(AUFTRAG_STATUS[auftrag.bearbeitungsstatus]?.phase ?? 'offen'),
  ).length;
  return {
    wert: offen,
    beschreibung: `${plural(offen, 'offener Auftrag', 'offene Aufträge')}, davon ${plural(ueberfaellig, 'überfällig', 'überfällig')}`,
  };
}

export function berechneErinnerungsZaehler(
  erinnerungen: Array<Pick<Erinnerung, 'ist_faellig' | 'status'>>,
): ModulZaehlerWert {
  const faellig = erinnerungen.filter(
    (erinnerung) => erinnerung.ist_faellig && erinnerung.status === 'offen',
  ).length;
  return {
    wert: faellig,
    beschreibung: plural(faellig, 'fällige Erinnerung', 'fällige Erinnerungen'),
  };
}

export function berechneChatZaehler(
  kanaele: Array<Pick<ChatKanal, 'ungelesen_anzahl'>>,
): ModulZaehlerWert {
  const ungelesen = kanaele.reduce((summe, kanal) => summe + kanal.ungelesen_anzahl, 0);
  return {
    wert: ungelesen,
    beschreibung: plural(ungelesen, 'ungelesene Chat-Nachricht', 'ungelesene Chat-Nachrichten'),
  };
}

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
 * LFH-639: aktive Evakuierungsbezirke — nicht storniert, nicht aufgehoben. „Aktiv" steht
 * EINMAL in `betreuung/evakuierungKennzahl.ts`, damit Zähler und Kennzahl nicht
 * auseinanderlaufen.
 */
export function berechneBetreuungZaehler(
  bezirke: ReadonlyArray<Pick<Evakuierungsbezirk, 'raeumung' | 'storniert_at'>>,
): ModulZaehlerWert {
  const aktiv = bezirke.filter(istAktiverBezirk).length;
  return {
    wert: aktiv,
    beschreibung: plural(aktiv, 'aktiver Evakuierungsbezirk', 'aktive Evakuierungsbezirke'),
  };
}

/**
 * Zähler laden nur für ein tatsächlich sichtbares UND freies Modul. Damit erzeugt ein
 * ausgeblendetes/rollen-gesperrtes Modul weder 403-Rauschen noch einen Seitenkanal über Daten.
 */
export function darfZaehlerLaden(
  quelle: ModulZaehlerQuelle,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
): boolean {
  const modul = modulRegistry.find((eintrag) => eintrag.zaehlerQuelle === quelle);
  return Boolean(
    modul && istModulSichtbar(modul, overrides) && !istModulGesperrt(modul, benutzer, overrides),
  );
}

/** Berechtigungsgesteuerte Counter-Abfragen für den Einsatz-Navigationsrahmen. */
export function useModulZaehler({ einsatzId, benutzer, overrides }: Args): ModulZaehlerMap {
  const gueltigerEinsatz = Number.isFinite(einsatzId);
  const meldungenAktiv = gueltigerEinsatz && darfZaehlerLaden('meldungen', benutzer, overrides);
  const auftraegeAktiv = gueltigerEinsatz && darfZaehlerLaden('auftraege', benutzer, overrides);
  const erinnerungenAktiv =
    gueltigerEinsatz && darfZaehlerLaden('erinnerungen', benutzer, overrides);
  const chatAktiv = gueltigerEinsatz && darfZaehlerLaden('chat', benutzer, overrides);
  const dokumenteAktiv = gueltigerEinsatz && darfZaehlerLaden('dokumente', benutzer, overrides);
  const abloesungAktiv = gueltigerEinsatz && darfZaehlerLaden('abloesung', benutzer, overrides);
  const betreuungAktiv = gueltigerEinsatz && darfZaehlerLaden('betreuung', benutzer, overrides);

  const meldungen = useQuery({
    queryKey: einsatzKeys.meldungen(einsatzId),
    queryFn: () => listeMeldungen(einsatzId),
    enabled: meldungenAktiv,
  });
  const auftraege = useQuery({
    queryKey: einsatzKeys.auftraege(einsatzId),
    queryFn: () => listeAuftraege(einsatzId),
    enabled: auftraegeAktiv,
  });
  const erinnerungen = useQuery({
    queryKey: einsatzKeys.erinnerungen(einsatzId),
    queryFn: () => listeErinnerungen(einsatzId, false),
    enabled: erinnerungenAktiv,
  });
  const chat = useQuery({
    queryKey: einsatzKeys.chatKanaele(einsatzId),
    queryFn: () => listeKanaele(einsatzId),
    enabled: chatAktiv,
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
  // Dieselbe Query wie Seite und Kennzahl (`useEvakuierungKennzahl`): ein Abruf, ein Cache-Fach.
  const betreuung = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
    enabled: betreuungAktiv,
  });
  // Die Einstufung hängt an der Uhr, nicht nur am Abruf: ohne Wecker bliebe der Zähler bei
  // einer Schicht, die gerade in die Vorwarnzeit läuft, still auf dem alten Stand.
  const jetzt = useEinstufungsUhr(abloesungAktiv ? abloesungen.data : undefined);

  return {
    meldungen:
      meldungenAktiv && meldungen.isSuccess ? berechneMeldungsZaehler(meldungen.data) : undefined,
    auftraege:
      auftraegeAktiv && auftraege.isSuccess ? berechneAuftragsZaehler(auftraege.data) : undefined,
    erinnerungen:
      erinnerungenAktiv && erinnerungen.isSuccess
        ? berechneErinnerungsZaehler(erinnerungen.data)
        : undefined,
    chat: chatAktiv && chat.isSuccess ? berechneChatZaehler(chat.data) : undefined,
    dokumente:
      dokumenteAktiv && dokumente.isSuccess ? berechneDokumentZaehler(dokumente.data) : undefined,
    abloesung:
      abloesungAktiv && abloesungen.isSuccess
        ? berechneAbloesungZaehler(abloesungen.data, jetzt)
        : undefined,
    betreuung:
      betreuungAktiv && betreuung.isSuccess
        ? berechneBetreuungZaehler(betreuung.data.bezirke)
        : undefined,
  };
}
