import {
  IconGlocke,
  IconGlockeAus,
  IconHakenKreis,
  IconMonitor,
  IconVerbotsschild,
} from '../icons';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { alsZeitpunkt, zuWanduhr } from '../anzeige/zeitEingabe';
import { App, Button, Dropdown, Tooltip } from 'antd';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ALARM_TON_STATUS_EVENT,
  alarmTonStatus,
  entsperreAlarmTon,
  istAlarmGemutet,
  pruefeAlarmTonBereitschaft,
  setzeAlarmMute,
  type AlarmTonStatus,
} from '../alarm/alarmTon';
import {
  desktopPermission,
  fordereDesktopPermission,
  schliesseAlleDesktopAlarme,
  schliesseDesktopAlarm,
  schliesseDesktopMeldung,
  zeigeDesktopAlarm,
} from '../alarm/desktopAlarm';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  abloesungPfad,
  auftraegePfad,
  erinnerungenPfad,
  meldungenPfad,
  wetterPegelPfad,
} from '../routing/deeplinks';
import { useViewport } from '../components/useViewport';
import { farbenDunkel, rahmenFarben } from '../theme/tokens';

/**
 * Farbe eines Alarm-Knopfs in der Kommandoleiste. Die Leiste ist in beiden Modi dunkel, die
 * Werte kommen deshalb aus den NACHTrollen. Ein auffälliger Zustand
 * („stumm", „blockiert") steht in `achtung`: er verzögert eine Alarmierung, ist selbst keine.
 * Der zweite Kanal ist das Wort im Knopf (WCAG 1.4.1).
 */
function alarmKnopfFarbe(auffaellig: boolean): string {
  return auffaellig ? farbenDunkel.achtung : rahmenFarben.gedaempft;
}

dayjs.extend(utc);

/** Payload des Scheduler-Hinweises `abloesung` (`src/erinnerung/scheduler.rs`). */
type AbloesungAlarmDetail = {
  abloesung_id?: number;
  art?: 'vorwarnung' | 'faellig';
  /** „Ablösung fällig: Florian 1" — Titel der Frist, trägt den Einheitsnamen. */
  titel?: string;
  /** Fälligkeit der Schicht (UTC-Wire), auch bei der Vorwarnung. */
  faellig_at?: string;
};

/**
 * Toast-Text eines Ablösungshinweises: Einheit und Uhrzeit der Fälligkeit in der Anzeigezone
 * (LFH-692; `zone` `null` = Browserzone). Rein, getestet.
 */
function abloesungAlarmText(
  detail: AbloesungAlarmDetail,
  zone: string | null,
): {
  titel: string;
  beschreibung: string;
} {
  const einheit = detail.titel?.split(': ').slice(1).join(': ') || 'eine Einheit';
  const f = alsZeitpunkt(detail.faellig_at);
  const uhrzeit = f ? zuWanduhr(f, zone).format('HH:mm') : null;
  const bei = uhrzeit ? `${einheit}, ${uhrzeit}` : einheit;
  return detail.art === 'vorwarnung'
    ? { titel: 'Ablösung in 30 min', beschreibung: `Ablösung bald fällig: ${bei}` }
    : { titel: 'Ablösung fällig', beschreibung: `Ablösung fällig: ${bei}` };
}

/**
 * Payload von `lfh:unwetter-alarm` (`wetter/useUnwetterHinweis.ts`, LFH-663). Die Texte baut der
 * Auslöser, weil nur er die Anzeige-Konventionen des Einsatzes kennt; `schluessel` ist das Paar
 * aus Stufe und Ereignis.
 */
type UnwetterDetail = {
  schluessel?: string;
  titel?: string;
  beschreibung?: string;
};

type ErinnerungDetail = {
  erinnerung_id?: number;
  bezug_typ?: 'auftrag' | 'meldung' | 'etb' | null;
  bezug_id?: number | null;
};

type AlarmToast = {
  key: string;
  art: 'warning' | 'info';
  titel: string;
  beschreibung: string;
  aktion: ReactNode;
  ziel: AlarmZiel;
};

const MAX_SICHTBARE_TOASTS = 3;

type AlarmZiel = 'meldungen' | 'auftraege' | 'erinnerungen' | 'abloesung' | 'wetter-pegel';

type AlarmScope = {
  keyPrefix: string;
  sammelKey: string;
  aktiv: boolean;
  zaehler: number;
  einzelneToastKeys: string[];
  einzelneToastZiele: Map<string, AlarmZiel>;
  gebuendelteToastZiele: Map<string, AlarmZiel>;
  eigeneToastKeys: Set<string>;
  /** Key des zuletzt gezeigten Unwetterhinweises — ein neuer ersetzt ihn (ein Platz im Budget). */
  unwetterKey: string | null;
  /** `tag` der Desktop-Meldung zum letzten Unwetterhinweis — ein neuer ersetzt auch sie. */
  unwetterTag: string | null;
  /** Desktop-Meldung je Toast-Key: Quittieren im Toast schließt sie mit (LFH-951). */
  desktopMeldungen: Map<string, Notification>;
};

/**
 * Zustand der Benachrichtigungen (LFH-950). `nicht-verfuegbar` ist eine Eigenschaft des Geräts
 * (iOS-Safari ohne installierte PWA, Chromium auf Android), keine Störung: ohne Warnfarbe.
 */
type DesktopZustand = 'aus' | 'erlaubt' | 'blockiert' | 'nicht-verfuegbar';

/**
 * Tonzustand der Anzeige (LFH-637). `prueft` gilt, bis die Audio-Prüfung zum ersten Mal
 * antwortet: „blockiert" hieße dort etwas, das niemand festgestellt hat, und das Wort brach beim
 * Start die Kopfzeile bei 1024 px um (CLS 0,46). `prueft` ist keine Störung, steht also wie der
 * Ruhezustand: gedämpft, ohne durchgestrichene Glocke, zwischen `md` und `xl` ohne Wort. Seit
 * LFH-950 dauert es höchstens `ALARM_TON_FRIST_MS`: ohne Antwort meldet `alarmTon` danach
 * „blockiert", ein dauerhaftes „prüft" verdeckte sonst einen stummen Alarm.
 */
type TonZustand = AlarmTonStatus | 'prueft';

function desktopZustand(permission: NotificationPermission | 'unsupported'): DesktopZustand {
  if (permission === 'granted') return 'erlaubt';
  if (permission === 'default') return 'aus';
  if (permission === 'denied') return 'blockiert';
  return 'nicht-verfuegbar';
}

/** Zustandswort der Benachrichtigungen, ohne „Desktop": auf dem Telefon las es sich als Fehler. */
const DESKTOP_WORT: Record<DesktopZustand, string> = {
  aus: 'aus',
  erlaubt: 'erlaubt',
  blockiert: 'blockiert',
  'nicht-verfuegbar': 'nicht verfügbar',
};

/**
 * Bediengesten, die den Alarmton freischalten (LFH-950). `pointerdown` und `keydown` für Maus und
 * Tastatur; `pointerup`, weil ein Fingertipp erst beim Loslassen als Nutzeraktivierung zählt.
 */
const FREISCHALT_GESTEN = ['pointerdown', 'pointerup', 'keydown'] as const;

/** So lange gilt der Zustand beim Drücken für den folgenden Klick (siehe `tonUmschalten`). */
const GESTE_GILT_MS = 2000;
/** Gängige Doppelklickzeit der Betriebssysteme (Windows-Vorgabe 500 ms). */
const DOPPELKLICK_MS = 500;

/**
 * Einsatzweite Alarm-Zentrale: lauscht auf `lfh:sofortmeldung`, `lfh:erinnerung-alarm` und die
 * Ablösungshinweise (von useEinsatzLiveStream ausgelöst) sowie auf `lfh:unwetter-alarm` (vom
 * Rahmen, `wetter/useUnwetterHinweis.ts`) und zeigt NICHT selbst-schließende
 * Toasts mit Deeplink zur Quelle, optional eine Desktop-Benachrichtigung bei Hintergrund-Tab.
 * EIN globaler Mute (Per-User, localStorage) schaltet ALLE Alarmtöne. Im Layout-Kopf montiert,
 * wirkt also seitenunabhängig; die Einsatz-ID reicht der Rahmen schon geprüft herein (LFH-438).
 * Toasts über `App.useApp().notification` (kein statischer Import, sonst Kontext-Leak in Tests).
 */
export default function AlarmZentrale({ einsatzId }: { einsatzId: number }) {
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const zone = useAnzeigeKonventionen().konventionen.zeitzone ?? null;
  const instanzId = useId();
  const [gemutet, setGemutet] = useState(istAlarmGemutet());
  const [permission, setPermission] = useState(desktopPermission());
  const [tonStatus, setTonStatus] = useState<TonZustand>(alarmTonStatus() ?? 'prueft');
  // Jede Instanz verwaltet pro Einsatz einen eigenen Scope, damit langlebige Notices beim
  // Einsatzwechsel gezielt abgeräumt werden können, ohne fremde Notifications anzutasten.
  const alarmScope = useMemo<AlarmScope>(() => {
    const keyPrefix = `alarm-${einsatzId}-${instanzId}`;
    return {
      keyPrefix,
      sammelKey: `${keyPrefix}-zusammenfassung`,
      aktiv: true,
      zaehler: 0,
      einzelneToastKeys: [],
      einzelneToastZiele: new Map(),
      gebuendelteToastZiele: new Map(),
      eigeneToastKeys: new Set(),
      unwetterKey: null,
      unwetterTag: null,
      desktopMeldungen: new Map(),
    };
  }, [einsatzId, instanzId]);

  const alleToastsSchliessen = useCallback(() => {
    for (const key of alarmScope.eigeneToastKeys) {
      notification.destroy(key);
    }
    alarmScope.eigeneToastKeys.clear();
    alarmScope.einzelneToastKeys = [];
    alarmScope.einzelneToastZiele.clear();
    alarmScope.gebuendelteToastZiele.clear();
    alarmScope.desktopMeldungen.clear();
    // Mit den Toasts gehen die OS-Meldungen: Einsatzwechsel, Unmount und „Zu …" (LFH-951).
    schliesseAlleDesktopAlarme();
  }, [alarmScope, notification]);

  /**
   * Schließt die OS-Meldung zum Toast `key` (LFH-951). Über das Objekt, nicht den `tag`: zum
   * selben Bezug kann inzwischen eine neuere Meldung stehen, die niemand quittiert hat.
   */
  const desktopMeldungSchliessen = useCallback(
    (key: string) => {
      const desktop = alarmScope.desktopMeldungen.get(key);
      if (!desktop) return;
      alarmScope.desktopMeldungen.delete(key);
      schliesseDesktopMeldung(desktop);
    },
    [alarmScope],
  );

  /**
   * Ein Einzel-Toast ist erledigt (✕ oder „Öffnen"): Buchführung aufräumen, OS-Meldung schließen.
   * „Öffnen" ruft das selbst, denn `notification.destroy` ruft kein `onClose`; ein in die
   * Zusammenfassung verdrängter Toast geht ebenfalls über `destroy` und bleibt so unquittiert.
   */
  const toastErledigt = useCallback(
    (key: string) => {
      desktopMeldungSchliessen(key);
      alarmScope.eigeneToastKeys.delete(key);
      alarmScope.einzelneToastZiele.delete(key);
      alarmScope.einzelneToastKeys = alarmScope.einzelneToastKeys.filter((k) => k !== key);
    },
    [alarmScope, desktopMeldungSchliessen],
  );

  const zielPfad = useCallback(
    (ziel: AlarmZiel) => {
      if (ziel === 'auftraege') return auftraegePfad(einsatzId);
      if (ziel === 'erinnerungen') return erinnerungenPfad(einsatzId);
      if (ziel === 'abloesung') return abloesungPfad(einsatzId);
      if (ziel === 'wetter-pegel') return wetterPegelPfad(einsatzId);
      return meldungenPfad(einsatzId);
    },
    [einsatzId],
  );

  const zeigeZusammenfassung = useCallback(() => {
    if (!alarmScope.aktiv) return;
    const anzahl = alarmScope.gebuendelteToastZiele.size;
    const ziele = new Set(alarmScope.gebuendelteToastZiele.values());
    const nurSofortmeldungen = ziele.size === 1 && ziele.has('meldungen');
    const nurAuftraege = ziele.size === 1 && ziele.has('auftraege');
    const nurErinnerungen = ziele.size === 1 && ziele.has('erinnerungen');
    const nurAbloesungen = ziele.size === 1 && ziele.has('abloesung');
    let titel = `${anzahl} weitere Alarme`;
    let beschreibung =
      'Weitere Ereignisse sind eingegangen. Bitte in den betroffenen Modulen sichten.';
    if (nurSofortmeldungen) {
      titel = `${anzahl} weitere Sofortmeldungen`;
      beschreibung = 'Weitere Ereignisse sind eingegangen. Bitte die Meldungen gesammelt sichten.';
    } else if (nurAuftraege) {
      titel = `${anzahl} weitere Aufträge`;
      beschreibung = 'Weitere Aufträge sind überfällig. Bitte gesammelt sichten.';
    } else if (nurErinnerungen) {
      titel = `${anzahl} weitere Erinnerungen`;
      beschreibung = 'Weitere Erinnerungen sind fällig. Bitte gesammelt sichten.';
    } else if (nurAbloesungen) {
      titel = `${anzahl} weitere Ablösungen`;
      beschreibung = 'Weitere Ablösungen sind fällig oder stehen an. Bitte gesammelt sichten.';
    }
    const zielKonfiguration: Array<{ ziel: AlarmZiel; text: string }> = [
      { ziel: 'meldungen', text: 'Zu Meldungen' },
      { ziel: 'auftraege', text: 'Zu Aufträgen' },
      { ziel: 'erinnerungen', text: 'Zu Erinnerungen' },
      { ziel: 'abloesung', text: 'Zu Ablösungen' },
      { ziel: 'wetter-pegel', text: 'Zu Wetter & Pegel' },
    ];

    alarmScope.eigeneToastKeys.add(alarmScope.sammelKey);
    notification.warning({
      key: alarmScope.sammelKey,
      title: titel,
      description: beschreibung,
      duration: 0,
      actions: (
        <>
          {zielKonfiguration
            .filter(({ ziel }) => ziele.has(ziel))
            .map(({ ziel, text }, index) => (
              <Button
                key={ziel}
                type={index === 0 ? 'primary' : 'default'}
                onClick={() => {
                  if (!alarmScope.aktiv) return;
                  navigate(zielPfad(ziel));
                  alleToastsSchliessen();
                }}
              >
                {text}
              </Button>
            ))}
        </>
      ),
      onClose: () => {
        alarmScope.eigeneToastKeys.delete(alarmScope.sammelKey);
        // Mit der Zusammenfassung sind ihre Alarme quittiert, auch die OS-Meldungen dazu.
        for (const key of alarmScope.gebuendelteToastZiele.keys()) desktopMeldungSchliessen(key);
        alarmScope.gebuendelteToastZiele.clear();
      },
    });
  }, [
    alarmScope,
    alleToastsSchliessen,
    desktopMeldungSchliessen,
    navigate,
    notification,
    zielPfad,
  ]);

  /**
   * Höchstens drei sichtbare Notices, unabhängig von der globalen AntApp-Konfiguration: beim
   * vierten Ereignis werden die drei vorherigen zusammengefasst und der neueste bleibt einzeln;
   * danach wandert je neuem Ereignis der bisher neueste in die Zusammenfassung.
   */
  const zeigeAlarmToast = useCallback(
    (toast: AlarmToast) => {
      if (!alarmScope.aktiv) return;
      const toastEntfernen = () => toastErledigt(toast.key);
      if (alarmScope.einzelneToastKeys.includes(toast.key)) {
        alarmScope.eigeneToastKeys.add(toast.key);
        notification[toast.art]({
          key: toast.key,
          title: toast.titel,
          description: toast.beschreibung,
          duration: 0,
          actions: toast.aktion,
          onClose: toastEntfernen,
        });
        return;
      }
      if (alarmScope.gebuendelteToastZiele.has(toast.key)) return;

      if (
        alarmScope.gebuendelteToastZiele.size > 0 ||
        alarmScope.einzelneToastKeys.length >= MAX_SICHTBARE_TOASTS
      ) {
        for (const verdraengt of alarmScope.einzelneToastKeys) {
          const ziel = alarmScope.einzelneToastZiele.get(verdraengt);
          if (ziel) alarmScope.gebuendelteToastZiele.set(verdraengt, ziel);
          notification.destroy(verdraengt);
          alarmScope.eigeneToastKeys.delete(verdraengt);
        }
        alarmScope.einzelneToastKeys = [];
        alarmScope.einzelneToastZiele.clear();
        zeigeZusammenfassung();
      }

      alarmScope.einzelneToastKeys.push(toast.key);
      alarmScope.einzelneToastZiele.set(toast.key, toast.ziel);
      alarmScope.eigeneToastKeys.add(toast.key);
      notification[toast.art]({
        key: toast.key,
        title: toast.titel,
        description: toast.beschreibung,
        duration: 0,
        actions: toast.aktion,
        onClose: toastEntfernen,
      });
    },
    [alarmScope, notification, toastErledigt, zeigeZusammenfassung],
  );

  // `duration: 0`-Notices überleben sonst ihre Komponente. Bei Logout/Unmount und vor dem nächsten
  // Einsatz werden deshalb nur die Keys dieses Scopes zerstört.
  useEffect(() => {
    // StrictMode führt Setup → Cleanup → Setup aus; der zweite Setup muss denselben Scope wieder
    // freigeben.
    alarmScope.aktiv = true;
    return () => {
      alarmScope.aktiv = false;
      alleToastsSchliessen();
    };
  }, [alarmScope, alleToastsSchliessen]);

  // Stummer Einsatz-Einstiegstest + Statusabgleich mit späteren Abspielversuchen.
  useEffect(() => {
    let aktiv = true;
    void pruefeAlarmTonBereitschaft().then((status) => {
      if (aktiv) setTonStatus(status);
    });
    const onStatus = (ev: Event) => {
      const status = (ev as CustomEvent<{ status?: AlarmTonStatus }>).detail?.status;
      if (status) setTonStatus(status);
    };
    window.addEventListener(ALARM_TON_STATUS_EVENT, onStatus);
    return () => {
      aktiv = false;
      window.removeEventListener(ALARM_TON_STATUS_EVENT, onStatus);
    };
  }, []);

  // Browser-Einstellungen können außerhalb der App geändert werden; beim Zurückkehren in den Tab
  // wird der Zustand neu gelesen. Ist der Tab wieder sichtbar, tragen die Toasts die Alarme, und
  // die OS-Meldungen dieses Tabs werden geschlossen (LFH-951): sonst häuften sich erledigte
  // Alarme im Benachrichtigungs-Center.
  useEffect(() => {
    const aktualisieren = () => {
      setPermission(desktopPermission());
      if (!document.hidden) schliesseAlleDesktopAlarme();
    };
    window.addEventListener('focus', aktualisieren);
    document.addEventListener('visibilitychange', aktualisieren);
    return () => {
      window.removeEventListener('focus', aktualisieren);
      document.removeEventListener('visibilitychange', aktualisieren);
    };
  }, []);

  // Sofortmeldung.
  useEffect(() => {
    const onSofort = (ev: Event) => {
      const detail = (ev as CustomEvent<{ meldung_id?: number }>).detail ?? {};
      const fachKey =
        detail.meldung_id != null
          ? `sofort-${detail.meldung_id}`
          : `sofort-${++alarmScope.zaehler}`;
      const key = `${alarmScope.keyPrefix}-${fachKey}`;
      // `tag` nur mit fachlichem Schlüssel; der Zähler ist keiner (LFH-951).
      const desktopTag =
        detail.meldung_id != null ? `${einsatzId}-sofort-${detail.meldung_id}` : undefined;
      const oeffnen = () => {
        if (!alarmScope.aktiv) return;
        navigate(meldungenPfad(einsatzId));
        notification.destroy(key);
        toastErledigt(key);
      };
      zeigeAlarmToast({
        key,
        art: 'warning',
        titel: 'Sofortmeldung eingegangen',
        beschreibung: 'Eine Sofortmeldung erfordert Aufmerksamkeit — bitte sichten und bestätigen.',
        aktion: (
          <Button type="primary" onClick={oeffnen}>
            Öffnen
          </Button>
        ),
        ziel: 'meldungen',
      });
      const desktop = zeigeDesktopAlarm('Sofortmeldung eingegangen', {
        koerper: 'Bitte sichten und bestätigen.',
        tag: desktopTag,
        beiKlick: () => {
          if (alarmScope.aktiv) navigate(meldungenPfad(einsatzId));
        },
      });
      if (desktop) alarmScope.desktopMeldungen.set(key, desktop);
    };
    window.addEventListener('lfh:sofortmeldung', onSofort);
    return () => window.removeEventListener('lfh:sofortmeldung', onSofort);
  }, [alarmScope, notification, navigate, einsatzId, toastErledigt, zeigeAlarmToast]);

  // Fällige Erinnerung / Auftrags-Eskalation.
  useEffect(() => {
    const onErinnerung = (ev: Event) => {
      const detail = (ev as CustomEvent<ErinnerungDetail>).detail ?? {};
      const istAuftrag = detail.bezug_typ === 'auftrag';
      const fachKey = istAuftrag
        ? detail.bezug_id != null
          ? `auftrag-${detail.bezug_id}`
          : `auftrag-${++alarmScope.zaehler}`
        : detail.erinnerung_id != null
          ? `erinnerung-${detail.erinnerung_id}`
          : `erinnerung-${++alarmScope.zaehler}`;
      const key = `${alarmScope.keyPrefix}-${fachKey}`;
      const fachId = istAuftrag ? detail.bezug_id : detail.erinnerung_id;
      const desktopTag =
        fachId != null
          ? `${einsatzId}-${istAuftrag ? 'auftrag' : 'erinnerung'}-${fachId}`
          : undefined;
      const titel = istAuftrag ? 'Auftrag überfällig' : 'Erinnerung fällig';
      const beschreibung = istAuftrag
        ? 'Ein Auftrag ist über seine Quittierfrist — bitte prüfen und quittieren.'
        : 'Eine Erinnerung ist fällig — bitte sichten.';
      const ziel =
        istAuftrag && detail.bezug_id != null
          ? auftraegePfad(einsatzId, { auftrag: detail.bezug_id })
          : erinnerungenPfad(einsatzId);
      const oeffnen = () => {
        if (!alarmScope.aktiv) return;
        navigate(ziel);
        notification.destroy(key);
        toastErledigt(key);
      };
      zeigeAlarmToast({
        key,
        art: istAuftrag ? 'warning' : 'info',
        titel,
        beschreibung,
        aktion: (
          <Button type="primary" onClick={oeffnen}>
            Öffnen
          </Button>
        ),
        ziel: istAuftrag ? 'auftraege' : 'erinnerungen',
      });
      const desktop = zeigeDesktopAlarm(titel, {
        koerper: beschreibung,
        tag: desktopTag,
        beiKlick: () => {
          if (alarmScope.aktiv) navigate(ziel);
        },
      });
      if (desktop) alarmScope.desktopMeldungen.set(key, desktop);
    };
    window.addEventListener('lfh:erinnerung-alarm', onErinnerung);
    return () => window.removeEventListener('lfh:erinnerung-alarm', onErinnerung);
  }, [alarmScope, notification, navigate, einsatzId, toastErledigt, zeigeAlarmToast]);

  // Fällige oder anstehende Ablösung — durch DENSELBEN Budget-Weg (`zeigeAlarmToast`), ein
  // eigener Zähler hebelte das gemeinsame Budget aus. Vorwarnung und Fälligkeit sind zwei
  // Hinweise (eigener Key je Art), der Scheduler löst je Frist einmal aus.
  useEffect(() => {
    const onAbloesung = (ev: Event) => {
      const detail = (ev as CustomEvent<AbloesungAlarmDetail>).detail ?? {};
      const fachKey =
        detail.abloesung_id != null
          ? `abloesung-${detail.abloesung_id}-${detail.art ?? 'faellig'}`
          : `abloesung-${++alarmScope.zaehler}`;
      const key = `${alarmScope.keyPrefix}-${fachKey}`;
      const desktopTag =
        detail.abloesung_id != null
          ? `${einsatzId}-abloesung-${detail.abloesung_id}-${detail.art ?? 'faellig'}`
          : undefined;
      const { titel, beschreibung } = abloesungAlarmText(detail, zone);
      const ziel = abloesungPfad(einsatzId);
      const oeffnen = () => {
        if (!alarmScope.aktiv) return;
        navigate(ziel);
        notification.destroy(key);
        toastErledigt(key);
      };
      zeigeAlarmToast({
        key,
        art: detail.art === 'vorwarnung' ? 'info' : 'warning',
        titel,
        beschreibung,
        aktion: (
          <Button type="primary" onClick={oeffnen}>
            Öffnen
          </Button>
        ),
        ziel: 'abloesung',
      });
      const desktop = zeigeDesktopAlarm(titel, {
        koerper: beschreibung,
        tag: desktopTag,
        beiKlick: () => {
          if (alarmScope.aktiv) navigate(ziel);
        },
      });
      if (desktop) alarmScope.desktopMeldungen.set(key, desktop);
    };
    window.addEventListener('lfh:abloesung-alarm', onAbloesung);
    return () => window.removeEventListener('lfh:abloesung-alarm', onAbloesung);
  }, [alarmScope, notification, navigate, einsatzId, toastErledigt, zeigeAlarmToast, zone]);

  // Neue Unwetterwarnung am Einsatzort (LFH-663,
  // `openspec/changes/archive/2026-10-01-lfh-663-unwetterwarnung-alarmbudget/design.md` D1/D6). Kein Live-Ereignis:
  // der Rahmen erkennt „neu" selbst und meldet es hierher, der Ton spielt dort. Ein neuer Hinweis
  // ERSETZT einen noch einzeln sichtbaren älteren — das Wetter belegt nie mehr als einen der drei
  // Plätze. Eigener Key je Auslösung, damit „schon gebündelt" ihn nie verschluckt.
  useEffect(() => {
    const onUnwetter = (ev: Event) => {
      const detail = (ev as CustomEvent<UnwetterDetail>).detail ?? {};
      // Je Auslösung ein eigener Key: läge der alte Hinweis desselben Paars noch gebündelt in der
      // Zusammenfassung, verschluckte „schon gebündelt" sonst den neuen.
      const key = `${alarmScope.keyPrefix}-unwetter-${detail.schluessel ?? 'ohne'}-${++alarmScope.zaehler}`;
      const vorher = alarmScope.unwetterKey;
      if (vorher && alarmScope.einzelneToastKeys.includes(vorher)) {
        notification.destroy(vorher);
        toastErledigt(vorher);
      }
      alarmScope.unwetterKey = key;
      // Die OS-Meldung zieht mit dem Toast gleich (LFH-951): die neue ersetzt die ältere, auch
      // wenn das Paar ein anderes ist. Dasselbe Paar ersetzt sie schon über den `tag`.
      const desktopTag = `${einsatzId}-unwetter-${detail.schluessel ?? 'ohne'}`;
      if (alarmScope.unwetterTag && alarmScope.unwetterTag !== desktopTag) {
        schliesseDesktopAlarm(alarmScope.unwetterTag);
      }
      alarmScope.unwetterTag = desktopTag;
      const titel = detail.titel ?? 'Unwetterwarnung';
      const beschreibung =
        detail.beschreibung ?? 'Für den Einsatzort liegt eine Unwetterwarnung vor.';
      const ziel = wetterPegelPfad(einsatzId);
      const oeffnen = () => {
        if (!alarmScope.aktiv) return;
        navigate(ziel);
        notification.destroy(key);
        toastErledigt(key);
      };
      zeigeAlarmToast({
        key,
        art: 'warning',
        titel,
        beschreibung,
        aktion: (
          <Button type="primary" onClick={oeffnen}>
            Öffnen
          </Button>
        ),
        ziel: 'wetter-pegel',
      });
      const desktop = zeigeDesktopAlarm(titel, {
        koerper: beschreibung,
        tag: desktopTag,
        beiKlick: () => {
          if (alarmScope.aktiv) navigate(ziel);
        },
      });
      if (desktop) alarmScope.desktopMeldungen.set(key, desktop);
    };
    window.addEventListener('lfh:unwetter-alarm', onUnwetter);
    return () => window.removeEventListener('lfh:unwetter-alarm', onUnwetter);
  }, [alarmScope, notification, navigate, einsatzId, toastErledigt, zeigeAlarmToast]);

  // Freischaltung bei der ersten Bediengeste irgendwo in der App (LFH-950): ein Klick auf die
  // Karte genügt, niemand muss die Glocke finden. Der Zuhörer merkt sich außerdem den Zustand
  // BEIM DRÜCKEN: die Freischaltung aus `pointerdown` ist durch, bevor der Klick kommt, und ohne
  // diese Lesung schaltete der Tipp auf die gesperrte Glocke danach stumm.
  //
  // Gelesen wird der Zustand aus dem Modul, nicht aus React: der gerenderte Wert hinkt nach, bis
  // der nächste Render samt Effekten durch ist, und eine Geste in dieser Lücke ginge verloren.
  const gesteRef = useRef<{ gemutet: boolean; tonStatus: TonZustand; zeit: number } | null>(null);
  /** Zeitpunkt der letzten Geste, die freischalten musste (siehe `tonUmschalten`). */
  const freigabeRef = useRef(0);
  useEffect(() => {
    const beiGeste = (ev: Event) => {
      const status = alarmTonStatus() ?? 'prueft';
      if (ev.type !== 'pointerup') {
        gesteRef.current = { gemutet: istAlarmGemutet(), tonStatus: status, zeit: Date.now() };
      }
      if (status !== 'bereit') {
        freigabeRef.current = Date.now();
        void entsperreAlarmTon();
      }
    };
    for (const typ of FREISCHALT_GESTEN) window.addEventListener(typ, beiGeste, true);
    return () => {
      for (const typ of FREISCHALT_GESTEN) window.removeEventListener(typ, beiGeste, true);
    };
  }, []);

  // In `prueft` und `blockiert` schaltet ein Tipp frei, NIE stumm (LFH-950): stumm hieße dort,
  // den Alarm abzuschalten, den die Person gerade hören wollte. Maßgeblich ist der Zustand, den
  // sie beim Drücken gesehen hat. Der zweite Klick eines Doppelklicks auf die gesperrte Glocke
  // sieht schon „bereit"; er gehört noch zum Freischalten und schaltet nicht stumm.
  const tonUmschalten = async () => {
    const geste = gesteRef.current;
    gesteRef.current = null;
    const vorher =
      geste && Date.now() - geste.zeit <= GESTE_GILT_MS ? geste : { gemutet, tonStatus };
    const freigabeGerade = Date.now() - freigabeRef.current <= DOPPELKLICK_MS;
    if (!vorher.gemutet && vorher.tonStatus === 'bereit' && freigabeGerade) return;
    if (vorher.gemutet) {
      setzeAlarmMute(false);
      setGemutet(false);
      setTonStatus(await entsperreAlarmTon());
      return;
    }
    if (vorher.tonStatus !== 'bereit') {
      setTonStatus(await entsperreAlarmTon());
      return;
    }
    setzeAlarmMute(true);
    setGemutet(true);
  };

  // Die Breitenfrage stellt `useViewport`. Unter `md` bündelt die Zentrale zu EINEM Ziel (siehe
  // unten). Zwischen `md` und `xl` (Führungs-Tablet) bleiben es mit Maus zwei Knöpfe, der
  // RUHEZUSTAND steht aber nur als Icon — die Wörter brachen die Kopfzeile bei 1024 px auf zwei
  // Zeilen. Eine STÖRUNG („Ton stumm/blockiert", „Benachrichtigung blockiert") trägt ihr Wort auf
  // jeder Breite; Wort und Warnfarbe hängen an derselben Bedingung.
  //
  // Mit grobem Zeiger zwischen `md` und `xl` gilt die Bauform des Handschirms (LFH-950): ein
  // Tooltip erscheint auf Touch erst NACH dem Tipp, und der Tipp auf die Glocke schaltete den Ton
  // sofort und für jeden Einsatz stumm. Das Menü nennt Handlung und Zustand, bevor etwas schaltet.
  const { istSchmal, abBreite, istBeruehrung } = useViewport();
  const knapp = !abBreite('xl');
  const buendeln = istSchmal || (knapp && istBeruehrung);

  const desktopAktivieren = () => {
    fordereDesktopPermission((p) => setPermission(p));
  };

  const desktop = desktopZustand(permission);
  const desktopText = `Benachrichtigung ${DESKTOP_WORT[desktop]}`;
  const desktopHinweis =
    desktop === 'aus'
      ? 'Benachrichtigungen sind aus – aktivieren'
      : desktop === 'erlaubt'
        ? 'Benachrichtigungen sind erlaubt'
        : desktop === 'blockiert'
          ? 'Benachrichtigungen sind im Browser blockiert'
          : 'Benachrichtigungen sind auf diesem Gerät nicht verfügbar';
  const tonText = gemutet
    ? 'Ton stumm'
    : tonStatus === 'bereit'
      ? 'Ton bereit'
      : tonStatus === 'prueft'
        ? 'Ton wird geprüft'
        : 'Ton blockiert';
  // Name und Tooltip des Knopfs: die Handlung. In `prueft`/`blockiert` mit Zustand, denn die
  // Handlung („freischalten") erklärt sich erst durch ihn.
  const tonHinweis = gemutet
    ? 'Alarmton einschalten'
    : tonStatus === 'bereit'
      ? 'Alarmton stummschalten'
      : tonStatus === 'prueft'
        ? 'Alarmton wird geprüft – tippen zum Freischalten'
        : 'Alarmton blockiert – tippen zum Freischalten';
  // Menüeintrag: Zustand UND Handlung als ein Satz — dort steht kein Tooltip daneben.
  const tonSatz = gemutet
    ? 'Alarmton ist stumm – einschalten'
    : tonStatus === 'bereit'
      ? 'Alarmton ist bereit – stummschalten'
      : tonHinweis;

  // Einmal abgeleitet, von BEIDEN Bauformen benutzt, damit dasselbe Zeichen an zwei Orten dasselbe
  // heißt. `aria-hidden` bleibt als zweite Sicherung, obwohl das Icon des Satzes selbst
  // `aria-hidden` ist (LFH-595): antds Menü hängt keins davor, und mit einem Namen hieße der
  // Eintrag „stop Benachrichtigung blockiert".
  const desktopIcon =
    desktop === 'erlaubt' ? (
      <IconHakenKreis />
    ) : desktop === 'blockiert' ? (
      <IconVerbotsschild />
    ) : (
      <IconMonitor />
    );
  // Die Glocke trägt KEINEN Marker (LFH-513): ein roter Punkt an „Ton bereit" verbrauchte die
  // Alarmfarbe für eine Nichtmeldung. Die Störung trägt Form (durchgestrichen) und Wort, die
  // Farbe erbt das Icon vom Knopf (`alarmKnopfFarbe`) bzw. vom Menüeintrag.
  const tonAuffaellig = gemutet || tonStatus === 'blockiert';
  const tonIcon = tonAuffaellig ? <IconGlockeAus /> : <IconGlocke />;
  const desktopAuffaellig = desktop === 'blockiert';

  if (buendeln) {
    // ── EIN Ziel statt zwei auf dem Handschirm und dem Tablet mit Finger ──────────────
    // Auf 390 px bekommt die Aktionsreihe 180 px, zwei beschriftete Knöpfe brauchen 286 und brächen
    // um. Nur-Icon ist gesperrt („blockiert"/„stumm" muss benannt bleiben), `nowrap` ebenso. Also
    // bündeln: die Marke NENNT den Zustand, beide Steuerungen liegen beschriftet im Menü.
    //
    // Der hörbare Kanal geht vor: ein stummer Alarm ist schwerer zu bemerken als eine fehlende
    // Benachrichtigung. Die Marke nennt die Benachrichtigung nur, wenn SIE gestört ist und der Ton
    // nicht; „aus" oder „nicht verfügbar" sind keine Störung und stehen im Menü (LFH-950). Eine
    // Zeile trägt EINEN Zustand: sind beide auffällig, steht der Benachrichtigungs-Zustand nur im
    // Menü (`desktopHinweis`).
    //
    // Auf dem Tablet steht der Ruhezustand wie in der breiten Bauform nur als Icon (LFH-637), eine
    // Störung mit Wort.
    //
    // Zwei Einträge verstoßen nicht gegen „ab drei bündeln": hier bündelt die Breite bzw. der
    // Finger, nicht die Bequemlichkeit. Der Preis: Stummschalten kostet zwei Tipper.
    const zeigtTon = tonAuffaellig || !desktopAuffaellig;
    const sammelText = zeigtTon ? tonText : desktopText;
    const sammelAuffaellig = zeigtTon ? tonAuffaellig : desktopAuffaellig;

    return (
      <Dropdown
        trigger={['click']}
        menu={{
          autoFocus: true,
          // Die Einträge tragen Handlung UND Zustand in einem Satz: „Ton bereit" als Eintrag, der
          // stummschaltet, läse sich als Gegenteil — und ohne Zeiger gibt es keinen Tooltip.
          items: [
            {
              key: 'desktop',
              icon: desktopIcon,
              label: desktopHinweis,
              // Wie am breiten Knopf: nur `aus` ist vom Browser aus änderbar.
              disabled: desktop !== 'aus',
            },
            { key: 'ton', icon: tonIcon, label: tonSatz },
          ],
          // Die Zuordnung hängt am MENÜ, nicht je Eintrag — ein Ort für einen etwaigen Riegel.
          onClick: ({ key }) => {
            if (key === 'desktop') desktopAktivieren();
            else void tonUmschalten();
          },
        }}
      >
        <Button
          type="text"
          // Der zugängliche Name trägt Gruppe UND Zustand.
          aria-label={`Alarmzentrale: ${sammelText}`}
          icon={zeigtTon ? tonIcon : desktopIcon}
          style={{
            color: alarmKnopfFarbe(sammelAuffaellig),
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {istSchmal || sammelAuffaellig ? sammelText : null}
        </Button>
      </Dropdown>
    );
  }

  const desktopWort = knapp && !desktopAuffaellig ? null : desktopText;
  const tonWort = knapp && !tonAuffaellig ? null : tonText;

  return (
    <>
      <Tooltip title={desktopWort ? desktopHinweis : `${desktopText} — ${desktopHinweis}`}>
        <Button
          type="text"
          aria-label={`Benachrichtigungen: ${DESKTOP_WORT[desktop]}`}
          aria-disabled={desktop !== 'aus'}
          onClick={desktop === 'aus' ? desktopAktivieren : undefined}
          icon={desktopIcon}
          style={{ color: alarmKnopfFarbe(desktopAuffaellig), fontSize: 12 }}
        >
          {desktopWort}
        </Button>
      </Tooltip>
      <Tooltip title={tonWort ? tonHinweis : `${tonText} — ${tonHinweis}`}>
        <Button
          type="text"
          aria-label={tonHinweis}
          aria-pressed={gemutet}
          onClick={() => void tonUmschalten()}
          style={{
            color: alarmKnopfFarbe(tonAuffaellig),
            fontSize: 12,
          }}
          icon={tonIcon}
        >
          {tonWort}
        </Button>
      </Tooltip>
    </>
  );
}
