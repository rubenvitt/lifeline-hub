import { ApiError } from '../api/client';
import { legePersonAn, type PersonAnlegenEingabe } from '../api/einsatzPerson';
import { legeMeldungAn } from '../api/meldungen';
import type { Meldung, NeueMeldung, Person } from '../api/types';
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';
import { istOfflineTransient } from './fehler';
import { schreibaktionEinreihen } from './queue';

export type OfflineSchreibErgebnis<T> =
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
