import type { ApiSendOptionen } from '../api/client';
import {
  createMassnahme,
  createVerletzung,
  erfasseSichtung,
  erfasseVerbleib,
  legeNotizAn,
  saveTransport,
  type MassnahmeEingabe,
  type NotizEingabe,
  type SichtungEingabe,
  type TransportEingabe,
  type VerbleibEingabe,
  type VerletzungEingabe,
} from '../api/einsatzPerson';
import type {
  Massnahme,
  Sichtung,
  Transport,
  Verbleib,
  Verlaufsnotiz,
  Verletzung,
} from '../api/types';
import type { OfflineSchreibaktion } from './queue';

/**
 * Die medizinischen Einträge einer Person, die ohne Netz vorgemerkt werden (LLH-1138, Change
 * `y18v58dt-pat-kern`, design.md D8; Spec `personen-verlauf`): Sichtung, Verbleib, Verlaufsnotiz,
 * Transport, Maßnahme und Verletzung. Jede Art hat genau einen POST, der `client_id` und
 * `zeitpunkt_at` annimmt. Das Aufheben einer Maßnahme oder Verletzung gehört nicht dazu: seine
 * Route kennt weder `client_id` noch Erfassungszeit, ein Replay endete in 409.
 */
export interface PersonEintragDaten {
  sichtung: SichtungEingabe;
  verbleib: VerbleibEingabe;
  notiz: NotizEingabe;
  transport: TransportEingabe;
  massnahme: MassnahmeEingabe;
  verletzung: VerletzungEingabe;
}

/** Die Antwort des Servers je Art. */
export interface PersonEintragAntwort {
  sichtung: Sichtung;
  verbleib: Verbleib;
  notiz: Verlaufsnotiz;
  transport: Transport;
  massnahme: Massnahme;
  verletzung: Verletzung;
}

export type PersonEintragArt = keyof PersonEintragDaten;

/** Alle Arten, in der Folge des Patientenkopfs. */
export const PERSON_EINTRAG_ARTEN = [
  'sichtung',
  'verbleib',
  'transport',
  'massnahme',
  'verletzung',
  'notiz',
] as const satisfies readonly PersonEintragArt[];

/**
 * Die Queue-Aktion eines Eintrags. `bezeichnung` ist die Registriernummer der Person („R-012“),
 * nur für die Anzeige (Wiederherstellungsbereich, Quittung); gesendet wird sie nicht.
 */
export type PersonEintragAktion = {
  [A in PersonEintragArt]: {
    art: A;
    person_id: number;
    bezeichnung: string;
    daten: PersonEintragDaten[A];
  };
}[PersonEintragArt];

const ARTEN: ReadonlySet<string> = new Set(PERSON_EINTRAG_ARTEN);

export function isPersonEintrag(aktion: OfflineSchreibaktion): aktion is PersonEintragAktion {
  return ARTEN.has(aktion.art);
}

/** Kartentitel im Wiederherstellungsbereich, mit dem Geschlecht des Worts. */
export const PERSON_EINTRAG_ABGELEHNT: Record<PersonEintragArt, string> = {
  sichtung: 'Abgelehnte Sichtung',
  verbleib: 'Abgelehnter Verbleib',
  notiz: 'Abgelehnte Verlaufsnotiz',
  transport: 'Abgelehnter Transport',
  massnahme: 'Abgelehnte Maßnahme',
  verletzung: 'Abgelehnte Verletzung',
};

/**
 * Sendet einen Eintrag über seinen einen POST — vom Senden-oder-Vormerken und vom Abgleich der
 * Queue (`useOfflineSync`). Exhaustiv über die Art.
 */
export function sendPersonEintrag(
  einsatzId: number,
  aktion: PersonEintragAktion,
  optionen: ApiSendOptionen,
): Promise<PersonEintragAntwort[PersonEintragArt]> {
  const pid = aktion.person_id;
  switch (aktion.art) {
    case 'sichtung':
      return erfasseSichtung(einsatzId, pid, aktion.daten, optionen);
    case 'verbleib':
      return erfasseVerbleib(einsatzId, pid, aktion.daten, optionen);
    case 'notiz':
      return legeNotizAn(einsatzId, pid, aktion.daten, optionen);
    case 'transport':
      return saveTransport(einsatzId, pid, aktion.daten, optionen);
    case 'massnahme':
      return createMassnahme(einsatzId, pid, aktion.daten, optionen);
    case 'verletzung':
      return createVerletzung(einsatzId, pid, aktion.daten, optionen);
    default: {
      const nie: never = aktion;
      throw new Error(`Unbekannter Personeneintrag ${JSON.stringify(nie)}`);
    }
  }
}
