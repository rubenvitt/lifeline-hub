/**
 * Tabübergreifende Meldung von An- und Abmeldung (LFH-387).
 *
 * Das Session-Cookie gilt für den ganzen Origin, der angemeldete Benutzer steht aber nur im
 * React-Zustand des einzelnen Tabs. Über diesen Kanal erfahren die anderen Tabs, dass sich
 * etwas geändert hat — und fragen dann selbst beim Server nach (`AuthProvider`, `pruefe`).
 *
 * Die Nachricht trägt bewusst KEINE Benutzerdaten: sie ist nur ein Anstoß, die Wahrheit ist
 * `GET /api/auth/me`. Die Sicherheit hängt ohnehin nicht an ihr, sondern am Server
 * (`X-Erwarteter-Benutzer-Id`, `api/client.ts`); der Kanal sorgt nur dafür, dass ein Tab schnell
 * nachzieht. Ohne `BroadcastChannel` ist alles ein stiller No-op — dann trägt die Prüfung beim
 * Wieder-Sichtbarwerden.
 *
 * Senden und Empfangen laufen über EIN Kanalobjekt je Tab: ein `BroadcastChannel` stellt sich
 * selbst nichts zu, ein zweites Objekt desselben Tabs dagegen schon. Mit getrennten Objekten
 * prüfte sich der meldende Tab nach jedem Login selbst — gemessen im Vitest, wo das `/me` der
 * Prüfung gegen einen frischen Login lief und ihn zurückrollte.
 */

const KANAL = 'lfh-auth';

export type AuthWechsel = { art: 'angemeldet' } | { art: 'abgemeldet' };

function istAuthWechsel(daten: unknown): daten is AuthWechsel {
  if (typeof daten !== 'object' || daten === null) return false;
  const art = (daten as { art?: unknown }).art;
  return art === 'angemeldet' || art === 'abgemeldet';
}

const hoerer = new Set<(wechsel: AuthWechsel) => void>();
/** Offen, solange jemand zuhört; ein offener Kanal hielte sonst Node-Testläufe am Leben. */
let kanal: BroadcastChannel | null = null;

function kanalDerHoerer(): BroadcastChannel | null {
  if (kanal || typeof BroadcastChannel === 'undefined') return kanal;
  kanal = new BroadcastChannel(KANAL);
  kanal.onmessage = (ereignis: MessageEvent<unknown>) => {
    if (!istAuthWechsel(ereignis.data)) return;
    const wechsel: AuthWechsel = { art: ereignis.data.art };
    for (const h of [...hoerer]) h(wechsel);
  };
  return kanal;
}

/** Meldet allen ANDEREN Tabs dieses Browsers einen Wechsel; der eigene Tab hört sich nicht. */
export function meldeAuthWechsel(wechsel: AuthWechsel): void {
  if (kanal) {
    kanal.postMessage(wechsel);
    return;
  }
  if (typeof BroadcastChannel === 'undefined') return;
  const einmalig = new BroadcastChannel(KANAL);
  einmalig.postMessage(wechsel);
  einmalig.close();
}

/** Hört auf Wechsel aus anderen Tabs; liefert die Abbestellung. */
export function abonniereAuthWechsel(beiWechsel: (wechsel: AuthWechsel) => void): () => void {
  if (!kanalDerHoerer()) return () => {};
  hoerer.add(beiWechsel);
  return () => {
    hoerer.delete(beiWechsel);
    if (hoerer.size === 0 && kanal) {
      kanal.close();
      kanal = null;
    }
  };
}
