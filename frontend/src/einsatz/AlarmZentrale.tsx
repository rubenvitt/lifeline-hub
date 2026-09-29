import { App, Badge, Button, Dropdown, Tooltip } from 'antd';
import { CheckCircleOutlined, DesktopOutlined, StopOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { TbBell, TbBellOff } from 'react-icons/tb';
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
  zeigeDesktopAlarm,
} from '../alarm/desktopAlarm';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  abloesungPfad,
  auftraegePfad,
  erinnerungenPfad,
  meldungenPfad,
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

/** Toast-Text eines Ablösungshinweises: Einheit und Ortszeit der Fälligkeit (rein, getestet). */
function abloesungAlarmText(detail: AbloesungAlarmDetail): {
  titel: string;
  beschreibung: string;
} {
  const einheit = detail.titel?.split(': ').slice(1).join(': ') || 'eine Einheit';
  const f = detail.faellig_at ? dayjs.utc(detail.faellig_at) : null;
  const uhrzeit = f?.isValid() ? f.local().format('HH:mm') : null;
  const bei = uhrzeit ? `${einheit}, ${uhrzeit}` : einheit;
  return detail.art === 'vorwarnung'
    ? { titel: 'Ablösung in 30 min', beschreibung: `Ablösung bald fällig: ${bei}` }
    : { titel: 'Ablösung fällig', beschreibung: `Ablösung fällig: ${bei}` };
}

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

type AlarmZiel = 'meldungen' | 'auftraege' | 'erinnerungen' | 'abloesung';

type AlarmScope = {
  keyPrefix: string;
  sammelKey: string;
  aktiv: boolean;
  zaehler: number;
  einzelneToastKeys: string[];
  einzelneToastZiele: Map<string, AlarmZiel>;
  gebuendelteToastZiele: Map<string, AlarmZiel>;
  eigeneToastKeys: Set<string>;
};

type DesktopZustand = 'aus' | 'erlaubt' | 'browser-blockiert';

function desktopZustand(permission: NotificationPermission | 'unsupported'): DesktopZustand {
  if (permission === 'granted') return 'erlaubt';
  if (permission === 'default') return 'aus';
  return 'browser-blockiert';
}

/**
 * Einsatzweite Alarm-Zentrale: lauscht auf `lfh:sofortmeldung`, `lfh:erinnerung-alarm` und die
 * Ablösungshinweise (von useEinsatzLiveStream ausgelöst) und zeigt NICHT selbst-schließende
 * Toasts mit Deeplink zur Quelle, optional eine Desktop-Benachrichtigung bei Hintergrund-Tab.
 * EIN globaler Mute (Per-User, localStorage) schaltet ALLE Alarmtöne. Im Layout-Kopf montiert,
 * wirkt also seitenunabhängig; die Einsatz-ID reicht der Rahmen schon geprüft herein (LFH-438).
 * Toasts über `App.useApp().notification` (kein statischer Import, sonst Kontext-Leak in Tests).
 */
export default function AlarmZentrale({ einsatzId }: { einsatzId: number }) {
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const instanzId = useId();
  const [gemutet, setGemutet] = useState(istAlarmGemutet());
  const [permission, setPermission] = useState(desktopPermission());
  const [tonStatus, setTonStatus] = useState<AlarmTonStatus>(alarmTonStatus() ?? 'blockiert');
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
  }, [alarmScope, notification]);

  const zielPfad = useCallback(
    (ziel: AlarmZiel) => {
      if (ziel === 'auftraege') return auftraegePfad(einsatzId);
      if (ziel === 'erinnerungen') return erinnerungenPfad(einsatzId);
      if (ziel === 'abloesung') return abloesungPfad(einsatzId);
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
        alarmScope.gebuendelteToastZiele.clear();
      },
    });
  }, [alarmScope, alleToastsSchliessen, navigate, notification, zielPfad]);

  /**
   * Höchstens drei sichtbare Notices, unabhängig von der globalen AntApp-Konfiguration: beim
   * vierten Ereignis werden die drei vorherigen zusammengefasst und der neueste bleibt einzeln;
   * danach wandert je neuem Ereignis der bisher neueste in die Zusammenfassung.
   */
  const zeigeAlarmToast = useCallback(
    (toast: AlarmToast) => {
      if (!alarmScope.aktiv) return;
      const toastEntfernen = () => {
        alarmScope.eigeneToastKeys.delete(toast.key);
        alarmScope.einzelneToastZiele.delete(toast.key);
        alarmScope.einzelneToastKeys = alarmScope.einzelneToastKeys.filter(
          (key) => key !== toast.key,
        );
      };
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
    [alarmScope, notification, zeigeZusammenfassung],
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
  // wird der Tri-State neu gelesen.
  useEffect(() => {
    const aktualisieren = () => setPermission(desktopPermission());
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
      const oeffnen = () => {
        if (!alarmScope.aktiv) return;
        navigate(meldungenPfad(einsatzId));
        notification.destroy(key);
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
      zeigeDesktopAlarm('Sofortmeldung eingegangen', {
        koerper: 'Bitte sichten und bestätigen.',
        beiKlick: () => {
          if (alarmScope.aktiv) navigate(meldungenPfad(einsatzId));
        },
      });
    };
    window.addEventListener('lfh:sofortmeldung', onSofort);
    return () => window.removeEventListener('lfh:sofortmeldung', onSofort);
  }, [alarmScope, notification, navigate, einsatzId, zeigeAlarmToast]);

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
      zeigeDesktopAlarm(titel, {
        koerper: beschreibung,
        beiKlick: () => {
          if (alarmScope.aktiv) navigate(ziel);
        },
      });
    };
    window.addEventListener('lfh:erinnerung-alarm', onErinnerung);
    return () => window.removeEventListener('lfh:erinnerung-alarm', onErinnerung);
  }, [alarmScope, notification, navigate, einsatzId, zeigeAlarmToast]);

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
      const { titel, beschreibung } = abloesungAlarmText(detail);
      const ziel = abloesungPfad(einsatzId);
      const oeffnen = () => {
        if (!alarmScope.aktiv) return;
        navigate(ziel);
        notification.destroy(key);
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
      zeigeDesktopAlarm(titel, {
        koerper: beschreibung,
        beiKlick: () => {
          if (alarmScope.aktiv) navigate(ziel);
        },
      });
    };
    window.addEventListener('lfh:abloesung-alarm', onAbloesung);
    return () => window.removeEventListener('lfh:abloesung-alarm', onAbloesung);
  }, [alarmScope, notification, navigate, einsatzId, zeigeAlarmToast]);

  const tonUmschalten = async () => {
    if (gemutet) {
      setzeAlarmMute(false);
      setGemutet(false);
      setTonStatus(await entsperreAlarmTon());
      return;
    }
    if (tonStatus === 'blockiert') {
      setTonStatus(await entsperreAlarmTon());
      return;
    }
    setzeAlarmMute(true);
    setGemutet(true);
  };

  // Die Breitenfrage stellt `useViewport`. Unter `md` bündelt die Zentrale zu EINEM Ziel (siehe
  // unten). Zwischen `md` und `xl` (Führungs-Tablet) bleiben es zwei Knöpfe, der RUHEZUSTAND steht
  // aber nur als Ikone — die Wörter brachen die Kopfzeile bei 1024 px auf zwei Zeilen. Eine
  // STÖRUNG („Ton stumm/blockiert", „Desktop blockiert") trägt ihr Wort auf jeder Breite; Wort und
  // Warnfarbe hängen an derselben Bedingung.
  const { istSchmal, abBreite } = useViewport();
  const knapp = !abBreite('xl');

  const desktopAktivieren = () => {
    fordereDesktopPermission((p) => setPermission(p));
  };

  const desktop = desktopZustand(permission);
  const desktopText =
    desktop === 'erlaubt'
      ? 'Desktop erlaubt'
      : desktop === 'aus'
        ? 'Desktop aus'
        : 'Desktop blockiert';
  const desktopHinweis =
    desktop === 'aus'
      ? 'Desktop-Benachrichtigungen aktivieren'
      : desktop === 'erlaubt'
        ? 'Desktop-Benachrichtigungen sind erlaubt'
        : 'Desktop-Benachrichtigungen sind im Browser blockiert';
  const tonText = gemutet ? 'Ton stumm' : tonStatus === 'bereit' ? 'Ton bereit' : 'Ton blockiert';
  const tonHinweis = gemutet
    ? 'Alarmton einschalten'
    : tonStatus === 'blockiert'
      ? 'Alarmton durch Klick entsperren'
      : 'Alarmton stummschalten';

  // Einmal abgeleitet, von BEIDEN Bauformen benutzt, damit dasselbe Zeichen an zwei Orten dasselbe
  // heißt. `aria-hidden` ist Pflicht: ein `@ant-design/icons`-Knoten setzt `role="img"` mit
  // ENGLISCHEM `aria-label`, und antds Menü hängt kein `aria-hidden` davor — der Eintrag hieße
  // sonst „stop Desktop blockiert".
  const desktopIkone =
    desktop === 'erlaubt' ? (
      <CheckCircleOutlined aria-hidden />
    ) : desktop === 'browser-blockiert' ? (
      <StopOutlined aria-hidden />
    ) : (
      <DesktopOutlined aria-hidden />
    );
  const tonIkone =
    gemutet || tonStatus === 'blockiert' ? (
      <TbBellOff aria-hidden />
    ) : (
      <Badge dot status="error">
        <TbBell aria-hidden style={{ color: rahmenFarben.gedaempft }} />
      </Badge>
    );

  if (istSchmal) {
    // ── EIN Ziel statt zwei auf dem Handschirm ────────────────────────────────
    // Auf 390 px bekommt die Aktionsreihe 180 px, zwei beschriftete Knöpfe brauchen 286 und brächen
    // um. Nur-Ikone ist gesperrt („blockiert"/„stumm" muss benannt bleiben), `nowrap` ebenso. Also
    // bündeln: die Marke NENNT den Zustand, beide Steuerungen liegen beschriftet im Menü.
    //
    // Der hörbare Kanal geht vor: ein stummer Alarm ist schwerer zu bemerken als eine fehlende
    // Desktop-Meldung. Sind beide unauffällig, nennt sie trotzdem einen Zustand („Ton bereit").
    // Eine Zeile trägt EINEN Zustand: sind Ton UND Desktop auffällig, steht der Desktop-Zustand nur
    // im Menü (`desktopHinweis`).
    //
    // Zwei Einträge verstoßen nicht gegen „ab drei bündeln": hier bündelt die Breite, nicht die
    // Bequemlichkeit. Der Preis: Stummschalten kostet auf dem Handschirm zwei Tipper.
    const tonAuffaellig = gemutet || tonStatus !== 'bereit';
    const zeigtTon = tonAuffaellig || desktop === 'erlaubt';
    const sammelText = zeigtTon ? tonText : desktopText;

    return (
      <Dropdown
        trigger={['click']}
        menu={{
          autoFocus: true,
          // Die Einträge tragen die HANDLUNG, der Auslöser den Zustand: „Ton bereit" als Eintrag, der
          // stummschaltet, läse sich als Gegenteil — und auf dem Handschirm gibt es keinen Tooltip.
          // `desktopHinweis`/`tonHinweis` benennen Handlung UND Zustand in einem Satz.
          items: [
            {
              key: 'desktop',
              icon: desktopIkone,
              label: desktopHinweis,
              // Wie am breiten Knopf: nur `aus` ist vom Browser aus änderbar.
              disabled: desktop !== 'aus',
            },
            { key: 'ton', icon: tonIkone, label: tonHinweis },
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
          icon={zeigtTon ? tonIkone : desktopIkone}
          style={{
            color: alarmKnopfFarbe(zeigtTon ? tonAuffaellig : desktop === 'browser-blockiert'),
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {sammelText}
        </Button>
      </Dropdown>
    );
  }

  const desktopAuffaellig = desktop === 'browser-blockiert';
  const tonAuffaelligBreit = gemutet || tonStatus !== 'bereit';
  const desktopWort = knapp && !desktopAuffaellig ? null : desktopText;
  const tonWort = knapp && !tonAuffaelligBreit ? null : tonText;

  return (
    <>
      <Tooltip title={desktopWort ? desktopHinweis : `${desktopText} — ${desktopHinweis}`}>
        <Button
          type="text"
          aria-label={`Desktop-Benachrichtigungen: ${desktopText.replace('Desktop ', '')}`}
          aria-disabled={desktop !== 'aus'}
          onClick={desktop === 'aus' ? desktopAktivieren : undefined}
          icon={desktopIkone}
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
            color: alarmKnopfFarbe(tonAuffaelligBreit),
            fontSize: 12,
          }}
          icon={tonIkone}
        >
          {tonWort}
        </Button>
      </Tooltip>
    </>
  );
}
