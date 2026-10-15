import { ApiError } from '../api/client';
import { ladeWebPushStand, meldeWebPushAb, meldeWebPushAn } from '../api/webPush';
import { inHuelle } from '../huelle/faehigkeiten';
import { sicherEntfernen, sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';

/**
 * Web Push in der Seite (LLH-1223, design.md D7/D8): Schalter „Auch bei geschlossener App“,
 * Wiederanmeldung nach einer neuen Sitzung und das Schließen der Push-Meldung beim Quittieren.
 * Den Empfang macht der Service Worker (`public/alarm-sw.js`).
 *
 * Das Abo hängt am Server an der Sitzung und fällt mit ihr. Damit die Wahl ein Sitzungsende
 * überlebt, merkt sich der Browser je Person, dass Push gewählt ist ({@link pushMerker}); die
 * nächste Sitzung derselben Person meldet das Abo still wieder an.
 */

/** `fehlt`: kein Schalter (Browser ohne Push, Hülle, Server ohne `--web-push`, Gerätekonto). */
export type PushZustand = 'fehlt' | 'aus' | 'an' | 'blockiert';

/** Schlüssel des Merkers im Browserspeicher; je Person, damit ein Wechsel ihn nicht erbt. */
export function pushMerker(benutzerId: number): string {
  return `lfh:web-push:${benutzerId}`;
}

/** Wie lange auf den Service Worker gewartet wird; ohne Registrierung löst `ready` nie auf. */
const WORKER_FRIST_MS = 10_000;

function moeglich(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'PushManager' in window &&
    'serviceWorker' in navigator &&
    !inHuelle()
  );
}

function registrierung(): Promise<ServiceWorkerRegistration> {
  return new Promise((aufloesen, ablehnen) => {
    const frist = setTimeout(
      () => ablehnen(new Error('Service Worker nicht bereit')),
      WORKER_FRIST_MS,
    );
    navigator.serviceWorker.ready.then(
      (reg) => {
        clearTimeout(frist);
        aufloesen(reg);
      },
      (fehler: unknown) => {
        clearTimeout(frist);
        ablehnen(fehler);
      },
    );
  });
}

/** Base64url (ohne Auffüllung) in Bytes, wie `pushManager.subscribe` den Schlüssel braucht. */
function bytesVon(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const roh = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(roh, (z) => z.charCodeAt(0));
}

function gleich(a: ArrayBuffer | null, b: Uint8Array): boolean {
  // Ein Browser, der den Schlüssel nicht nennt, bekommt das Abo nicht weggenommen.
  if (a == null) return true;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * Das Abo dieses Browsers zum Schlüssel der Instanz. Ein Abo zu einem anderen Schlüssel (andere
 * Instanz, zurückgespielte Sicherung) wird gekündigt und neu angelegt.
 */
async function abonnieren(schluessel: string): Promise<PushSubscription> {
  const reg = await registrierung();
  const key = bytesVon(schluessel);
  const vorhanden = await reg.pushManager.getSubscription();
  if (vorhanden && gleich(vorhanden.options.applicationServerKey, key)) return vorhanden;
  await vorhanden?.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

async function anmelden(abo: PushSubscription): Promise<void> {
  const json = abo.toJSON();
  await meldeWebPushAn({
    endpoint: abo.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  });
}

/** 404 (Server ohne Schalter) und 403 (Gerätekonto) heißen: hier gibt es kein Push. */
function ohnePush(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 403);
}

/** Der Stand für den Schalter. Wirft bei einem Fehler des Servers (die Seite zeigt ihn). */
export async function ladePushZustand(): Promise<PushZustand> {
  if (!moeglich()) return 'fehlt';
  let angemeldet: boolean;
  try {
    angemeldet = (await ladeWebPushStand()).angemeldet;
  } catch (e) {
    if (ohnePush(e)) return 'fehlt';
    throw e;
  }
  if (Notification.permission === 'denied') return 'blockiert';
  return angemeldet ? 'an' : 'aus';
}

/**
 * Schalter an. Fragt zuerst die Erlaubnis, noch in der Geste des Klicks; ohne Erlaubnis bleibt
 * alles beim Alten.
 */
export async function pushEinschalten(benutzerId: number): Promise<PushZustand> {
  const erlaubnis =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (erlaubnis === 'denied') return 'blockiert';
  if (erlaubnis !== 'granted') return 'aus';
  const { schluessel } = await ladeWebPushStand();
  await anmelden(await abonnieren(schluessel));
  sicherSchreiben(pushMerker(benutzerId), '1');
  return 'an';
}

/** Schalter aus: erst der Merker, damit ein halber Abbruch nicht wieder anmeldet. */
export async function pushAusschalten(benutzerId: number): Promise<PushZustand> {
  sicherEntfernen(pushMerker(benutzerId));
  await meldeWebPushAb();
  const abo = await (await registrierung()).pushManager.getSubscription();
  await abo?.unsubscribe();
  return 'aus';
}

/**
 * Nach jeder bestätigten Anmeldung: Hat diese Person Push auf diesem Browser gewählt, meldet die
 * neue Sitzung das Abo wieder an (das alte fiel mit der alten Sitzung). Fragt nie nach der
 * Erlaubnis und wirft nie.
 */
export async function pushAbgleichen(benutzerId: number): Promise<void> {
  try {
    if (!moeglich() || sicherLesen(pushMerker(benutzerId)) == null) return;
    if (Notification.permission !== 'granted') return;
    const stand = await ladeWebPushStand();
    await anmelden(await abonnieren(stand.schluessel));
  } catch {
    // Ohne Schalter am Server, offline oder ohne Worker: die App meldet weiter im Tab.
  }
}

/**
 * Schließt die Push-Meldung zu dieser Benachrichtigung (design.md D7), wenn sie in der App
 * quittiert ist. Die Meldungen des Tabs selbst schließt `desktopAlarm`; diese hier zeigte der
 * Worker. Wirft nie.
 */
export async function schliessePushMeldungen(benachrichtigungId: number): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (navigator.serviceWorker.controller == null) return;
    const liste = await (await registrierung()).getNotifications();
    for (const n of liste) {
      const daten = n.data as { benachrichtigung_id?: unknown } | null;
      if (daten?.benachrichtigung_id === benachrichtigungId) n.close();
    }
  } catch {
    // Keine Meldung zu schließen.
  }
}
