/**
 * Fähigkeiten der Desktop-Hülle (LFH-817/LFH-818, Entscheidung LFH-783). Die einzige Stelle im
 * Frontend, die die Kennung der Hülle liest.
 *
 * Die macOS-Hülle setzt per Init-Skript (`src-tauri/src/faehigkeiten.js`) vor dem ersten Skript
 * der Seite `window.__LIFELINE_HUELLE__ = { passkey: false }`. Die Kennung geht der
 * Feature-Erkennung vor: WKWebView meldet über `getClientCapabilities()` einen Passkey, den es in
 * der Hülle nicht einlöst. Jede Hülle, auch die unter Windows, trägt dort zudem die native Meldung
 * ein (`src-tauri/src/benachrichtigung.js`, Benachrichtigungskonzept D7), dazu das App-Badge
 * (LLH-1423). Ohne Kennung (Browser) oder ohne Feld bleibt alles wie bisher.
 *
 * Die iOS-Hülle (`ios/App/Huelle/huelle.js`, Change t39ltxxi, Spec `huellen-vertrag`) setzt dazu
 * `platform: 'ios'`, `version` und `haptics(kind)`. Die Desktop-Hüllen setzen seit LLH-1982
 * `platform` (`'macos'`, `'windows'`) und `version` (`src-tauri/src/kennung.js`); ältere tun es
 * nicht. Die Android-Hülle (`android/app/src/main/assets/huelle.js`, LLH-1989) setzt dieselben
 * Felder wie iOS mit `platform: 'android'`, aber ohne `setAppBadge`. Jedes Feld wird einzeln geprüft.
 */

declare global {
  interface Window {
    __LIFELINE_HUELLE__?: {
      /** Kennwort der Plattform: `'ios'`, `'android'`, `'macos'`, `'windows'`; Desktop-Hüllen vor LLH-1982 nichts. */
      readonly platform?: string;
      /** Volle Versionsangabe der Hülle (iOS: `LifelineVersion`, Android: `versionName`, Desktop: Workspace-Version). */
      readonly version?: string;
      /** Haptik der Hülle (Spec `huellen-vertrag`): nimmt jede Art an, tut für unbekannte nichts. */
      readonly haptics?: (kind: string) => unknown;
      readonly passkey?: boolean;
      readonly anmeldungImBrowser?: () => Promise<unknown>;
      readonly benachrichtigungZeigen?: (titel: string, text?: string) => Promise<unknown>;
      readonly setAppBadge?: (count: number) => Promise<unknown>;
      /** Die iOS-Hülle kann Push über APNs (`push_register`, `push_unregister`, `push_state`). */
      readonly push?: boolean;
      readonly pushRegister?: () => Promise<{
        registration_id: string;
        token: string;
        environment: string;
        key: string;
      }>;
      readonly pushUnregister?: () => Promise<unknown>;
      readonly pushState?: () => Promise<{
        permission: 'granted' | 'denied' | 'undetermined';
        registration_id?: string;
      }>;
    };
  }
}

/**
 * Sperrt die Hülle Passkeys (Anmeldung und Einrichtung)? Nur ein ausdrückliches `passkey: false`
 * sperrt; fehlt die Kennung oder das Feld, gilt der Bestand. Gelesen beim Aufruf, nicht beim
 * Laden des Moduls.
 */
export function huelleSperrtPasskey(): boolean {
  return window.__LIFELINE_HUELLE__?.passkey === false;
}

/**
 * „Im Browser anmelden“ (LFH-818): startet in der macOS-Hülle die Anmeldung im Systembrowser. Das
 * Ergebnis meldet die Hülle später als {@link APP_ANMELDUNG_EREIGNIS}. `null` außerhalb der Hülle.
 */
export function huelleAnmeldungImBrowser(): (() => Promise<void>) | null {
  const anmelden = window.__LIFELINE_HUELLE__?.anmeldungImBrowser;
  if (typeof anmelden !== 'function') return null;
  return async () => {
    await anmelden();
  };
}

/** Ereignis, mit dem die Hülle das Ergebnis der Anmeldung im Browser meldet (LFH-818). */
export const APP_ANMELDUNG_EREIGNIS = 'lifeline:app-anmeldung';

export type AppAnmeldungErgebnis = 'angemeldet' | 'abgelehnt' | 'fehler' | 'abgebrochen';

/**
 * Native Meldung des Betriebssystems (Benachrichtigungskonzept D7): in der Hülle der Weg für eine
 * Meldung bei verdecktem Fenster, statt der Web-Notification-API. `null` außerhalb der Hülle.
 */
export function huelleBenachrichtigung(): ((titel: string, text?: string) => Promise<void>) | null {
  const zeigen = window.__LIFELINE_HUELLE__?.benachrichtigungZeigen;
  if (typeof zeigen !== 'function') return null;
  return async (titel, text) => {
    await zeigen(titel, text);
  };
}

/**
 * Zahl am Symbol der Desktop-App (LLH-1423): in der Hülle der Weg statt der Badging API; 0 nimmt
 * sie weg. `null` außerhalb der Hülle.
 */
export function huelleAppBadge(): ((count: number) => Promise<void>) | null {
  const setzen = window.__LIFELINE_HUELLE__?.setAppBadge;
  if (typeof setzen !== 'function') return null;
  return async (count) => {
    await setzen(count);
  };
}

/**
 * Läuft die Seite in einer App-Hülle (Desktop, iOS oder Android)? Dort meldet die Hülle selbst (D7); Web
 * Push (LLH-1223) bietet die Seite in keiner Hülle an (Spec `web-push`).
 */
export function inHuelle(): boolean {
  return window.__LIFELINE_HUELLE__ != null;
}

/** Kennwort der Plattform der Hülle (`'ios'`, `'android'`, `'macos'`, `'windows'`); `null` im Browser und in Desktop-Hüllen vor LLH-1982. */
export function huellePlatform(): string | null {
  const platform = window.__LIFELINE_HUELLE__?.platform;
  return typeof platform === 'string' ? platform : null;
}

/** Volle Version der Hülle; `null`, wo keine Hülle eine nennt (Browser, Desktop-Hülle vor LLH-1982). */
export function huelleVersion(): string | null {
  const version = window.__LIFELINE_HUELLE__?.version;
  return typeof version === 'string' ? version : null;
}

/**
 * Die Arten der Haptik (Spec `huellen-vertrag`, design.md D6): angenommen, Alarm, abgelehnt,
 * Wechsel im Segment, nur vorgemerkt.
 */
export type HapticsKind = 'success' | 'warning' | 'error' | 'selection' | 'tap';

/**
 * Haptische Rückmeldung der Hülle: feuern und vergessen. Ohne Hülle oder ohne `haptics` tut sie
 * nichts; sie wartet nicht und wirft nie, auch nicht, wenn die Hülle wirft oder ablehnt — die
 * Handlung, die sie auslöst, bleibt davon unberührt.
 */
export function huelleHaptics(kind: HapticsKind): void {
  try {
    const haptics = window.__LIFELINE_HUELLE__?.haptics;
    if (typeof haptics !== 'function') return;
    const ergebnis: unknown = haptics(kind);
    // Auch ein Thenable aus der Hülle: seine Ablehnung bleibt keine unbehandelte Zurückweisung.
    if (typeof (ergebnis as PromiseLike<unknown> | null)?.then === 'function') {
      Promise.resolve(ergebnis).catch(() => {});
    }
  } catch {
    // Ohne Haptik geht es weiter.
  }
}

/**
 * Push über APNs in der iOS-Hülle (Entwurf „iOS-Alarme über APNs“). `register` fragt die
 * Berechtigung, holt das Token und liefert Kennung (`registration_id`), Umgebung und den Schlüssel
 * der Nutzlast; die Brücke lehnt mit `denied` (Berechtigung verweigert) oder `unavailable` ab.
 * `state` fragt nie nach der Berechtigung und nennt die Kennung, sobald die App eine für diesen
 * Server angelegt hat, auch wenn ihr Schlüssel fehlt. Token und Schlüssel gehören in kein Log.
 */
export type HuellePush = {
  register(): Promise<{
    registration_id: string;
    token: string;
    environment: 'sandbox' | 'production';
    key: string;
  }>;
  unregister(): Promise<void>;
  state(): Promise<{
    permission: 'granted' | 'denied' | 'undetermined';
    registration_id?: string;
  }>;
};

/** Der Push der Hülle, wenn sie ihn kann (`push === true` und alle drei Funktionen); sonst `null`. */
export function huellePush(): HuellePush | null {
  const h = window.__LIFELINE_HUELLE__;
  if (h?.push !== true) return null;
  const { pushRegister, pushUnregister, pushState } = h;
  if (
    typeof pushRegister !== 'function' ||
    typeof pushUnregister !== 'function' ||
    typeof pushState !== 'function'
  ) {
    return null;
  }
  return {
    register: async () => {
      const r = await pushRegister();
      return { ...r, environment: r.environment === 'production' ? 'production' : 'sandbox' };
    },
    unregister: async () => {
      await pushUnregister();
    },
    state: () => pushState(),
  };
}
