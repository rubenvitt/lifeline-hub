import dayjs from 'dayjs';
import { meldeBelegung, meldeStand } from '../api/betreuung';
import { ApiError } from '../api/client';
import { legePersonAn, type PersonAnlegenEingabe } from '../api/einsatzPerson';
import { legeMeldungAn } from '../api/meldungen';
import type {
  AusgabeEingabe,
  BelegungsmeldungEingabe,
  BezirkMeldung,
  Meldung,
  NeueMeldung,
  Person,
  StandmeldungEingabe,
  StelleMeldung,
  VerpflegungAusgabeErgebnis,
} from '../api/types';
import { erfasseAusgabe } from '../api/verpflegung';
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';
import { alsBackendZeit } from '../etb/filterZeit';
import { istOfflineTransient } from './fehler';
import { schreibaktionEinreihen } from './queue';

type OfflineSchreibErgebnis<T> =
  { zustand: 'gesendet'; daten: T } | { zustand: 'vorgemerkt'; client_id: string };

function clientId(vorgegeben?: string): string {
  return vorgegeben ?? crypto.randomUUID();
}

async function vormerken(
  benutzerId: number,
  einsatzId: number,
  aktion: Parameters<typeof schreibaktionEinreihen>[2],
  client_id: string,
): Promise<{ zustand: 'vorgemerkt'; client_id: string }> {
  await schreibaktionEinreihen(benutzerId, einsatzId, aktion);
  return { zustand: 'vorgemerkt', client_id };
}

/** Person atomar mit Initialstatus anlegen oder sicher für den späteren Flush
 * vormerken. Durch die stabile client_id ist auch Timeout-nach-Commit sicher. */
export async function erfassePersonOfflineFaehig(
  benutzerId: number,
  einsatzId: number,
  eingabe: PersonAnlegenEingabe,
): Promise<OfflineSchreibErgebnis<Person>> {
  const daten: PersonAnlegenEingabe = {
    ...eingabe,
    status: eingabe.status ?? 'erfasst',
    client_id: clientId(eingabe.client_id),
  };
  if (!navigator.onLine) {
    return vormerken(benutzerId, einsatzId, { art: 'person', daten }, daten.client_id!);
  }
  try {
    return {
      zustand: 'gesendet',
      daten: await legePersonAn(einsatzId, daten, {
        offlineQueueBenutzerId: benutzerId,
      }),
    };
  } catch (e) {
    if (!istOfflineTransient(e)) throw e;
    if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
    return vormerken(benutzerId, einsatzId, { art: 'person', daten }, daten.client_id!);
  }
}

/** Meldung senden oder sicher vormerken. Die Form darf nach `vorgemerkt`
 * geleert werden: der vollständige Wortlaut liegt dann persistent in IndexedDB. */
export async function erfasseMeldungOfflineFaehig(
  benutzerId: number,
  einsatzId: number,
  eingabe: NeueMeldung,
): Promise<OfflineSchreibErgebnis<Meldung>> {
  const daten: NeueMeldung = {
    ...eingabe,
    client_id: clientId(eingabe.client_id),
  };
  if (!navigator.onLine) {
    return vormerken(benutzerId, einsatzId, { art: 'meldung', daten }, daten.client_id!);
  }
  try {
    return {
      zustand: 'gesendet',
      daten: await legeMeldungAn(einsatzId, daten, {
        offlineQueueBenutzerId: benutzerId,
      }),
    };
  } catch (e) {
    if (!istOfflineTransient(e)) throw e;
    if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
    return vormerken(benutzerId, einsatzId, { art: 'meldung', daten }, daten.client_id!);
  }
}

/** Ziel einer Meldung oder Ausgabe (Bezirk, Stelle, Zeitfenster); die Bezeichnung steht nur in
 * der Anzeige der Queue, gesendet wird sie nicht. */
interface SchreibZiel {
  id: number;
  bezeichnung: string;
}

/**
 * Gemeinsamer Ablauf für Schreibvorgänge mit Erfassungszeitpunkt: Stand- und
 * Belegungsmeldungen (LFH-675), Verpflegungsausgaben (LFH-688). Die `client_id` wird EINMAL vor dem
 * Senden gesetzt: Online-Versuch und vorgemerkte Kopie tragen denselben Schlüssel, ein Timeout
 * nach dem Commit wird beim Flush zum Replay.
 *
 * Nur die vorgemerkte Kopie bekommt den Erfassungszeitpunkt (falls keiner eingetragen ist):
 * sonst stempelte der Server beim Flush „jetzt“, und eine ältere Zahl verdrängte eine neuere.
 * Online gilt die Serveruhr — eine vorgehende Tablet-Uhr machte sonst Meldungen zu 400.
 */
async function mitErfassungszeitOfflineFaehig<
  E extends { client_id?: string; zeitpunkt_at?: string },
  T,
>(
  benutzerId: number,
  einsatzId: number,
  eingabe: E,
  senden: (daten: E) => Promise<T>,
  aktion: (daten: E) => Parameters<typeof schreibaktionEinreihen>[2],
): Promise<OfflineSchreibErgebnis<T>> {
  const erfasst = alsBackendZeit(dayjs());
  const daten: E = { ...eingabe, client_id: clientId(eingabe.client_id) };
  const vormerkenMitZeit = () =>
    vormerken(
      benutzerId,
      einsatzId,
      aktion({ ...daten, zeitpunkt_at: daten.zeitpunkt_at ?? erfasst }),
      daten.client_id!,
    );
  if (!navigator.onLine) return vormerkenMitZeit();
  try {
    return { zustand: 'gesendet', daten: await senden(daten) };
  } catch (e) {
    if (!istOfflineTransient(e)) throw e;
    if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
    return vormerkenMitZeit();
  }
}

/** Standmeldung senden oder mit Erfassungszeitpunkt vormerken. */
export function erfasseStandOfflineFaehig(
  benutzerId: number,
  einsatzId: number,
  bezirk: SchreibZiel,
  eingabe: StandmeldungEingabe,
): Promise<OfflineSchreibErgebnis<BezirkMeldung>> {
  return mitErfassungszeitOfflineFaehig(
    benutzerId,
    einsatzId,
    eingabe,
    (daten) => meldeStand(einsatzId, bezirk.id, daten, { offlineQueueBenutzerId: benutzerId }),
    (daten) => ({ art: 'stand', bezirk_id: bezirk.id, bezeichnung: bezirk.bezeichnung, daten }),
  );
}

/** Belegungsmeldung senden oder mit Erfassungszeitpunkt vormerken. */
export function erfasseBelegungOfflineFaehig(
  benutzerId: number,
  einsatzId: number,
  stelle: SchreibZiel,
  eingabe: BelegungsmeldungEingabe,
): Promise<OfflineSchreibErgebnis<StelleMeldung>> {
  return mitErfassungszeitOfflineFaehig(
    benutzerId,
    einsatzId,
    eingabe,
    (daten) => meldeBelegung(einsatzId, stelle.id, daten, { offlineQueueBenutzerId: benutzerId }),
    (daten) => ({ art: 'belegung', stelle_id: stelle.id, bezeichnung: stelle.bezeichnung, daten }),
  );
}

/** Verpflegungsausgabe senden oder mit Erfassungszeitpunkt vormerken (LFH-688). Vorgemerkt gibt
 * es noch keine `ausgabe_id` und damit kein „Rückgängig“. */
export function erfasseVerpflegungsausgabeOfflineFaehig(
  benutzerId: number,
  einsatzId: number,
  zeitfenster: SchreibZiel,
  eingabe: AusgabeEingabe,
): Promise<OfflineSchreibErgebnis<VerpflegungAusgabeErgebnis>> {
  return mitErfassungszeitOfflineFaehig(
    benutzerId,
    einsatzId,
    eingabe,
    (daten) =>
      erfasseAusgabe(einsatzId, zeitfenster.id, daten, { offlineQueueBenutzerId: benutzerId }),
    (daten) => ({
      art: 'ausgabe',
      zeitfenster_id: zeitfenster.id,
      bezeichnung: zeitfenster.bezeichnung,
      daten,
    }),
  );
}
