import { ApiError } from '../api/client';
import { ladeIosPushStand, meldeIosPushAb, meldeIosPushAn } from '../api/iosPush';
import { huellePush, type HuellePush } from '../huelle/faehigkeiten';
import { sicherEntfernen, sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';
import { stummeArten } from './eingaengeStumm';
import type { PushKanal } from './pushKanal';
import { MERKER_MIT_INHALT, type PushStand, type PushZustand } from './webPush';

/**
 * iOS-Push in der Seite (Entwurf „iOS-Alarme über APNs“, Spec `ios-push`): derselbe Schalter wie
 * bei Web Push (`webPush.ts`), aber der Empfang läuft über die App. Die Hülle liefert Kennung
 * (`registration_id`), Token, Umgebung und Schlüssel; die Seite meldet sie dem Server.
 *
 * Wie bei Web Push merkt sich der Browser je Person, dass Push gewählt ist ({@link iosPushMerker},
 * Wert `'1'` oder {@link MERKER_MIT_INHALT}); die nächste Sitzung meldet das Gerät still wieder an.
 * Die Anmeldung hängt am Server an Konto und Gerät, nicht an der Sitzung, ändert sich aber das
 * Token (Neuinstallation, Gerätewechsel), meldet {@link abgleichen} es neu; die Kennung und der
 * Schlüssel bleiben, solange die App sie behält.
 *
 * Token und Schlüssel stehen in keinem Log und nie im Browserspeicher (dort nur ein Hash).
 */

/** Hinweis, wenn das Relais diese Instanz gesperrt hat (`relais_gesperrt`). */
export const RELAIS_GESPERRT_HINWEIS =
  'Der Push-Dienst nimmt diesen Server nicht an. Bitte den Betreiber informieren.';

/**
 * Am gekoppelten ELW (`ueber_hub`) statt des Schalters: in der App führt kein Link zum Hub (der
 * Webview zeigt nur den aktiven Server), die Person nimmt den Hub als eigenen Server in die App und
 * schaltet Push dort ein (Entwurf „iOS-Alarme über APNs“, Kopplung).
 */
export function iosPushUeberHub(name: string): string {
  return `Push läuft über ${name}: Hub in der App hinzufügen und dort einschalten.`;
}

/** Schlüssel des Merkers im Browserspeicher; je Person, damit ein Wechsel ihn nicht erbt. */
export function iosPushMerker(benutzerId: number): string {
  return `lfh:ios-push:${benutzerId}`;
}

/**
 * SHA-256 aus Kennung und Token, die dieses Gerät zuletzt angemeldet hat: der Seitenstart erkennt
 * daran ein geändertes Token, ohne es im Speicher zu halten.
 */
export const IOS_PUSH_TOKEN_MERKER = 'lfh:ios-push-token';

async function tokenKennung(kennung: string, token: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${kennung}:${token}`),
  );
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

type Registrierung = Awaited<ReturnType<HuellePush['register']>>;

/** Die Berechtigung ist verweigert (Antwort der Brücke `denied`). */
function istVerweigert(e: unknown): boolean {
  return e instanceof Error && e.message === 'denied';
}

/** Laufende Anmeldungen, eine nach der anderen (siehe {@link anmelden}). */
let anmeldeKette: Promise<unknown> = Promise.resolve();

/**
 * Meldet das Gerät an. Die Anmeldungen laufen nacheinander, und jede liest die stummen Arten erst,
 * wenn sie dran ist: Nach schnellem Umschalten käme sonst eine ältere als letzte an.
 */
function anmelden(r: Registrierung, inhalt: boolean): Promise<void> {
  const schritt = anmeldeKette.then(async () => {
    await meldeIosPushAn({
      kennung: r.registration_id,
      token: r.token,
      umgebung: r.environment,
      schluessel: r.key,
      inhalt,
      stumm: [...stummeArten()],
    });
    sicherSchreiben(IOS_PUSH_TOKEN_MERKER, await tokenKennung(r.registration_id, r.token));
  });
  anmeldeKette = schritt.catch(() => undefined);
  return schritt;
}

/** 404 (Server ohne Schalter) und 403 (Gerätekonto) heißen: hier gibt es kein Push. */
function ohnePush(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 403);
}

function gleicheArten(a: readonly string[], b: readonly string[]): boolean {
  const menge = new Set(a);
  return menge.size === new Set(b).size && b.every((art) => menge.has(art));
}

async function ladeStand(): Promise<PushStand> {
  const h = huellePush();
  if (h == null) return { zustand: 'fehlt', inhalt: false };
  let geraet: Awaited<ReturnType<HuellePush['state']>>;
  try {
    geraet = await h.state();
  } catch {
    return { zustand: 'fehlt', inhalt: false };
  }
  let stand: Awaited<ReturnType<typeof ladeIosPushStand>>;
  try {
    stand = await ladeIosPushStand(geraet.registration_id);
  } catch (e) {
    if (ohnePush(e)) return { zustand: 'fehlt', inhalt: false };
    throw e;
  }
  if (stand.ueber_hub) {
    return {
      zustand: 'ueber_hub',
      inhalt: false,
      hub: stand.ueber_hub,
      hinweis: iosPushUeberHub(stand.ueber_hub.name),
    };
  }
  if (stand.relais_gesperrt) {
    return { zustand: 'fehlt', inhalt: false, hinweis: RELAIS_GESPERRT_HINWEIS };
  }
  if (geraet.permission === 'denied') return { zustand: 'blockiert', inhalt: false };
  return stand.angemeldet
    ? { zustand: 'an', inhalt: stand.inhalt }
    : { zustand: 'aus', inhalt: false };
}

/** Registriert das Gerät (fragt bei Bedarf die Berechtigung); `null` bei verweigerter. */
async function registrieren(h: HuellePush): Promise<Registrierung | null> {
  try {
    return await h.register();
  } catch (e) {
    if (istVerweigert(e)) return null;
    throw e;
  }
}

async function einschalten(benutzerId: number): Promise<PushZustand> {
  const h = huellePush();
  if (h == null) return 'fehlt';
  const r = await registrieren(h);
  if (r == null) return 'blockiert';
  await anmelden(r, false);
  sicherSchreiben(iosPushMerker(benutzerId), '1');
  return 'an';
}

async function inhaltSetzen(benutzerId: number, an: boolean): Promise<boolean> {
  const h = huellePush();
  if (h == null) throw new Error('Kein Push in dieser Hülle');
  const r = await registrieren(h);
  if (r == null) throw new Error('Berechtigung verweigert');
  await anmelden(r, an);
  sicherSchreiben(iosPushMerker(benutzerId), an ? MERKER_MIT_INHALT : '1');
  return an;
}

/** Schalter aus: erst der Merker, damit ein halber Abbruch nicht wieder anmeldet. */
async function ausschalten(benutzerId: number): Promise<PushZustand> {
  sicherEntfernen(iosPushMerker(benutzerId));
  sicherEntfernen(IOS_PUSH_TOKEN_MERKER);
  const h = huellePush();
  if (h == null) return 'aus';
  const { registration_id: kennung } = await h.state();
  if (kennung != null) await meldeIosPushAb(kennung);
  await h.unregister();
  return 'aus';
}

/**
 * Nach jeder bestätigten Anmeldung und jedem Umschalten von „Stumm auf diesem Gerät“: Hat diese
 * Person Push auf diesem Gerät gewählt, meldet es das Gerät mit der aktuellen Wahl an. Fragt nie
 * nach der Berechtigung und wirft nie. `nurBeiBedarf` (Seitenstart): kennt der Server das Gerät
 * schon mit derselben Wahl und demselben Token, bleibt es stehen.
 */
async function abgleichen(
  benutzerId: number,
  { nurBeiBedarf = false }: { nurBeiBedarf?: boolean } = {},
): Promise<void> {
  try {
    const h = huellePush();
    const merker = h != null ? sicherLesen(iosPushMerker(benutzerId)) : null;
    if (h == null || merker == null) return;
    if ((await h.state()).permission !== 'granted') return;
    const r = await h.register();
    const stand = await ladeIosPushStand(r.registration_id);
    // Am gekoppelten ELW lehnt der Server jede Anmeldung ab; die alte ruht bis zum Entkoppeln.
    if (stand.ueber_hub) return;
    const inhalt = merker === MERKER_MIT_INHALT;
    if (
      nurBeiBedarf &&
      stand.angemeldet &&
      stand.inhalt === inhalt &&
      gleicheArten(stand.stumm, stummeArten()) &&
      sicherLesen(IOS_PUSH_TOKEN_MERKER) === (await tokenKennung(r.registration_id, r.token))
    ) {
      return;
    }
    await anmelden(r, inhalt);
  } catch {
    // Ohne Schalter am Server, offline oder ohne Brücke: die App meldet weiter im Tab.
  }
}

export const iosPushKanal: PushKanal = {
  ladeStand,
  einschalten,
  ausschalten,
  inhaltSetzen,
  abgleichen,
};
