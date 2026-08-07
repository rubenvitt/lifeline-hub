import { useQuery } from '@tanstack/react-query';
import { listeAuftraege } from '../api/auftraege';
import { listeErinnerungen } from '../api/erinnerungen';
import { listeKanaele } from '../api/chat';
import { listeMeldungen } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type {
  Auftrag, BenutzerAnzeige, ChatKanal, Erinnerung, Meldung, ModulOverrides,
} from '../api/types';
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
  const ungesehen = meldungen.filter((meldung) => meldung.ist_offen && meldung.status === 'neu').length;
  return {
    wert: offen,
    beschreibung: `${plural(offen, 'offene Meldung', 'offene Meldungen')}, davon ${plural(ungesehen, 'ungesehen', 'ungesehen')}`,
  };
}

export function berechneAuftragsZaehler(
  auftraege: Array<Pick<Auftrag, 'bearbeitungsstatus' | 'ist_ueberfaellig'>>,
): ModulZaehlerWert {
  const offen = auftraege.filter((auftrag) =>
    !istAbgeschlossen(AUFTRAG_STATUS[auftrag.bearbeitungsstatus]?.phase ?? 'offen'),
  ).length;
  const ueberfaellig = auftraege.filter((auftrag) =>
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
  const faellig = erinnerungen.filter((erinnerung) =>
    erinnerung.ist_faellig && erinnerung.status === 'offen',
  ).length;
  return { wert: faellig, beschreibung: plural(faellig, 'fällige Erinnerung', 'fällige Erinnerungen') };
}

export function berechneChatZaehler(
  kanaele: Array<Pick<ChatKanal, 'ungelesen_anzahl'>>,
): ModulZaehlerWert {
  const ungelesen = kanaele.reduce((summe, kanal) => summe + kanal.ungelesen_anzahl, 0);
  return { wert: ungelesen, beschreibung: plural(ungelesen, 'ungelesene Chat-Nachricht', 'ungelesene Chat-Nachrichten') };
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
  const erinnerungenAktiv = gueltigerEinsatz && darfZaehlerLaden('erinnerungen', benutzer, overrides);
  const chatAktiv = gueltigerEinsatz && darfZaehlerLaden('chat', benutzer, overrides);

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

  return {
    meldungen: meldungenAktiv && meldungen.isSuccess
      ? berechneMeldungsZaehler(meldungen.data)
      : undefined,
    auftraege: auftraegeAktiv && auftraege.isSuccess
      ? berechneAuftragsZaehler(auftraege.data)
      : undefined,
    erinnerungen: erinnerungenAktiv && erinnerungen.isSuccess
      ? berechneErinnerungsZaehler(erinnerungen.data)
      : undefined,
    chat: chatAktiv && chat.isSuccess ? berechneChatZaehler(chat.data) : undefined,
  };
}
