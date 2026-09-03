import { App, Badge, Button, Dropdown, Tooltip } from 'antd';
import { CheckCircleOutlined, DesktopOutlined, StopOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { TbBell, TbBellOff } from 'react-icons/tb';
import { useNavigate, useParams } from 'react-router';
import {
  ALARM_TON_STATUS_EVENT,
  alarmTonStatus,
  entsperreAlarmTon,
  istAlarmGemutet,
  pruefeAlarmTonBereitschaft,
  setzeAlarmMute,
  type AlarmTonStatus,
} from '../alarm/alarmTon';
import { desktopPermission, fordereDesktopPermission, zeigeDesktopAlarm } from '../alarm/desktopAlarm';
import { auftraegePfad, erinnerungenPfad, meldungenPfad } from '../routing/deeplinks';
import { useViewport } from '../components/useViewport';

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

type AlarmZiel = 'meldungen' | 'auftraege' | 'erinnerungen';

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

export function desktopZustand(
  permission: NotificationPermission | 'unsupported',
): DesktopZustand {
  if (permission === 'granted') return 'erlaubt';
  if (permission === 'default') return 'aus';
  return 'browser-blockiert';
}

/**
 * Einsatzweite Alarm-Zentrale (LFH-97/118): lauscht auf die window-CustomEvents
 * `lfh:sofortmeldung` und `lfh:erinnerung-alarm` (von useEinsatzLiveStream ausgelöst) und zeigt
 * unübersehbare, NICHT selbst-schließende Toasts mit Deeplink zur Quelle — plus optional eine
 * Desktop-Benachrichtigung bei Hintergrund-Tab. EIN globaler Mute-Toggle (Per-User, localStorage)
 * schaltet ALLE Alarmtöne. Im Layout-Header montiert → wirkt seitenunabhängig.
 * Toasts über App.useApp().notification (kein statischer Import — sonst Kontext-Leak in Tests).
 */
export default function AlarmZentrale() {
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const { id } = useParams();
  const einsatzId = Number(id);
  const instanzId = useId();
  const [gemutet, setGemutet] = useState(istAlarmGemutet());
  const [permission, setPermission] = useState(desktopPermission());
  const [tonStatus, setTonStatus] = useState<AlarmTonStatus>(alarmTonStatus() ?? 'blockiert');
  // Jede Komponenteninstanz verwaltet pro Einsatz einen eigenen Scope. Damit können
  // langlebige Notices beim Einsatzwechsel gezielt abgeräumt werden, ohne fremde
  // AntD-Notifications oder den neuen Einsatz anzutasten.
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

  const zielPfad = useCallback((ziel: AlarmZiel) => {
    if (ziel === 'auftraege') return auftraegePfad(einsatzId);
    if (ziel === 'erinnerungen') return erinnerungenPfad(einsatzId);
    return meldungenPfad(einsatzId);
  }, [einsatzId]);

  const zeigeZusammenfassung = useCallback(() => {
    if (!alarmScope.aktiv) return;
    const anzahl = alarmScope.gebuendelteToastZiele.size;
    const ziele = new Set(alarmScope.gebuendelteToastZiele.values());
    const nurSofortmeldungen = ziele.size === 1 && ziele.has('meldungen');
    const nurAuftraege = ziele.size === 1 && ziele.has('auftraege');
    const nurErinnerungen = ziele.size === 1 && ziele.has('erinnerungen');
    let titel = `${anzahl} weitere Alarme`;
    let beschreibung = 'Weitere Ereignisse sind eingegangen. Bitte in den betroffenen Modulen sichten.';
    if (nurSofortmeldungen) {
      titel = `${anzahl} weitere Sofortmeldungen`;
      beschreibung = 'Weitere Ereignisse sind eingegangen. Bitte die Meldungen gesammelt sichten.';
    } else if (nurAuftraege) {
      titel = `${anzahl} weitere Aufträge`;
      beschreibung = 'Weitere Aufträge sind überfällig. Bitte gesammelt sichten.';
    } else if (nurErinnerungen) {
      titel = `${anzahl} weitere Erinnerungen`;
      beschreibung = 'Weitere Erinnerungen sind fällig. Bitte gesammelt sichten.';
    }
    const zielKonfiguration: Array<{ ziel: AlarmZiel; text: string }> = [
      { ziel: 'meldungen', text: 'Zu Meldungen' },
      { ziel: 'auftraege', text: 'Zu Aufträgen' },
      { ziel: 'erinnerungen', text: 'Zu Erinnerungen' },
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
   * Maximal drei sichtbare Notices ohne Abhängigkeit von der globalen AntApp-Konfiguration:
   * Beim vierten Ereignis werden die drei vorherigen Einzeltoasts zusammengefasst und
   * der neueste bleibt einzeln sichtbar. Danach wandert bei jedem neuen Ereignis der
   * bisher neueste Einzeltoast ebenfalls in die Zusammenfassung.
   */
  const zeigeAlarmToast = useCallback((toast: AlarmToast) => {
    if (!alarmScope.aktiv) return;
    const toastEntfernen = () => {
      alarmScope.eigeneToastKeys.delete(toast.key);
      alarmScope.einzelneToastZiele.delete(toast.key);
      alarmScope.einzelneToastKeys = alarmScope.einzelneToastKeys
        .filter((key) => key !== toast.key);
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
      alarmScope.gebuendelteToastZiele.size > 0
      || alarmScope.einzelneToastKeys.length >= MAX_SICHTBARE_TOASTS
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
  }, [alarmScope, notification, zeigeZusammenfassung]);

  // duration: 0-Notices überleben sonst ihre Komponente. Bei Logout/Unmount und vor
  // dem nächsten Einsatz werden deshalb ausschließlich die Keys dieses Scopes zerstört.
  useEffect(() => {
    // React.StrictMode führt in Entwicklung Setup → Cleanup → Setup aus. Der zweite
    // Setup-Durchlauf muss denselben Scope wieder für Events und Aktionen freigeben.
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

  // Browser-Einstellungen können außerhalb der App geändert werden. Beim Zurückkehren
  // in den Tab den dauerhaft sichtbaren Tri-State deshalb erneut aus der API lesen.
  useEffect(() => {
    const aktualisieren = () => setPermission(desktopPermission());
    window.addEventListener('focus', aktualisieren);
    document.addEventListener('visibilitychange', aktualisieren);
    return () => {
      window.removeEventListener('focus', aktualisieren);
      document.removeEventListener('visibilitychange', aktualisieren);
    };
  }, []);

  // Sofortmeldung (LFH-97).
  useEffect(() => {
    const onSofort = (ev: Event) => {
      const detail = (ev as CustomEvent<{ meldung_id?: number }>).detail ?? {};
      const fachKey = detail.meldung_id != null
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
        aktion: (<Button type="primary" onClick={oeffnen}>Öffnen</Button>),
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

  // Fällige Erinnerung / Auftrags-Eskalation (LFH-118).
  useEffect(() => {
    const onErinnerung = (ev: Event) => {
      const detail = (ev as CustomEvent<ErinnerungDetail>).detail ?? {};
      const istAuftrag = detail.bezug_typ === 'auftrag';
      const fachKey = istAuftrag
        ? detail.bezug_id != null ? `auftrag-${detail.bezug_id}` : `auftrag-${++alarmScope.zaehler}`
        : detail.erinnerung_id != null
          ? `erinnerung-${detail.erinnerung_id}`
          : `erinnerung-${++alarmScope.zaehler}`;
      const key = `${alarmScope.keyPrefix}-${fachKey}`;
      const titel = istAuftrag ? 'Auftrag überfällig' : 'Erinnerung fällig';
      const beschreibung = istAuftrag
        ? 'Ein Auftrag ist über seine Quittierfrist — bitte prüfen und quittieren.'
        : 'Eine Erinnerung ist fällig — bitte sichten.';
      const ziel = istAuftrag && detail.bezug_id != null
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
        aktion: (<Button type="primary" onClick={oeffnen}>Öffnen</Button>),
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

  // Die Breitenfrage stellt ausschliesslich `useViewport` (erzwungen von
  // `useViewport.guard.test.ts`). `istSchmal` ist `< md` (768 px) — bei 768 px
  // und darüber trägt die Kopfzeile beide Knöpfe mühelos, eng wird es erst auf
  // dem Handschirm.
  const { istSchmal } = useViewport();

  const desktopAktivieren = () => {
    fordereDesktopPermission((p) => setPermission(p));
  };

  const desktop = desktopZustand(permission);
  const desktopText = desktop === 'erlaubt'
    ? 'Desktop erlaubt'
    : desktop === 'aus'
      ? 'Desktop aus'
      : 'Desktop blockiert';
  const desktopHinweis = desktop === 'aus'
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

  // Einmal abgeleitet, von BEIDEN Bauformen benutzt: die schmale zeigt dieselbe
  // Ikone wie der Knopf, den sie vertritt — sonst hiesse dasselbe Zeichen an
  // zwei Orten Verschiedenes.
  // `aria-hidden` ist hier Pflicht, nicht Kosmetik: ein `@ant-design/icons`-Knoten
  // setzt unbedingt `role="img"` samt ENGLISCHEM `aria-label` aus seinem Namen
  // (`AntdIcon.js`), und antds Menü hängt nirgends ein `aria-hidden` davor. Ohne
  // das hiesse der Menüeintrag vorgelesen „stop Desktop blockiert" — derselbe
  // Fall, den CLAUDE.md aus LFH-366 als „delete Bild entfernen" führt. Am breiten
  // Knopf fiel es nicht auf, weil dort ein eigenes `aria-label` den Namen setzt.
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
        <TbBell aria-hidden style={{ color: '#fff' }} />
      </Badge>
    );

  if (istSchmal) {
    // ── EIN Ziel statt zwei (LFH-511) ────────────────────────────────────────
    // Auf 390 px bekommt die Aktionsreihe 180 px; zwei beschriftete Knöpfe
    // brauchen 286. Bis hierher löste das der Browser selbst, indem er beide in
    // ihrem gemeinsamen `.ant-space-item` UMBRACH — waagerecht unauffällig,
    // senkrecht 144 px Inhalt in einem 96 px hohen Kopf, oben und unten
    // angeschnitten (gemessen, `e2e/kopfzeile-schmal.spec.ts`).
    //
    // Die naheliegende Abhilfe ist gesperrt: „blockiert"/„stumm" darf im Einsatz
    // nicht nur über eine Ikone laufen (CLAUDE.md, LFH-392). Ein blosses
    // `nowrap` ebenso — LFH-392 hat es gemessen, die Kopfzeile wuchs auf 486 px.
    // Bleibt die Bündelung: die Marke NENNT den Zustand, der genannt werden
    // muss, beide Steuerungen liegen vollständig beschriftet im Menü.
    //
    // WELCHEN Zustand sie nennt, ist keine Geschmacksfrage: ein stummer Alarm
    // ist im Einsatz schwerer zu bemerken als eine fehlende Desktop-Meldung —
    // der hörbare Kanal geht vor. Sind beide unauffällig, nennt sie trotzdem
    // einen Zustand („Ton bereit") statt eines erfundenen Sammelworts.
    //
    // EINE ZEILE TRÄGT EINEN ZUSTAND, NICHT ZWEI — das ist die bewusste Grenze
    // dieser Bauform. Sind Ton UND Desktop auffällig, nennt die Marke nur den
    // Ton; der Desktop-Zustand steht dann ausschliesslich im Menü (deshalb dort
    // `desktopHinweis` als Etikett, das ihn ausspricht). Beide nebeneinander
    // wären wieder 286 px — genau der Überlauf, den diese Bauform behebt.
    //
    // ZWEI EINTRÄGE SIND HIER KEIN VERSTOSS gegen „ab drei Aktionen bündeln"
    // (CLAUDE.md/LFH-366). Diese Regel wehrt das Bündeln aus BEQUEMLICHKEIT ab —
    // hier bündelt die Breite, nicht die Wahl: zwei beschriftete Ziele passen
    // nachweislich nicht. Der Preis ist echt und benannt: Stummschalten kostet
    // auf dem Handschirm zwei Tipper statt einem.
    const tonAuffaellig = gemutet || tonStatus !== 'bereit';
    const zeigtTon = tonAuffaellig || desktop === 'erlaubt';
    const sammelText = zeigtTon ? tonText : desktopText;

    return (
      <Dropdown
        trigger={['click']}
        menu={{
          autoFocus: true,
          // DIE EINTRÄGE TRAGEN DIE HANDLUNG, NICHT DEN ZUSTAND — der Auslöser
          // trägt den Zustand. Ein Eintrag „Ton bereit", der beim Antippen stumm
          // schaltet, liest sich als das Gegenteil dessen, was er tut; „Desktop
          // aus" fordert sogar die Berechtigung AN. Die breite Bauform hatte die
          // Handlung im Tooltip und im `aria-label` — und ausgerechnet der
          // Handschirm ist der einzige Kontext OHNE Hover, also ohne Tooltip.
          // `desktopHinweis`/`tonHinweis` benennen Handlung UND Zustand in einem
          // Satz; dadurch steht der Desktop-Zustand hier auch dann, wenn die
          // Marke oben gerade den Ton nennt.
          items: [
            {
              key: 'desktop',
              icon: desktopIkone,
              label: desktopHinweis,
              // Gleiche Regel wie am breiten Knopf: nur `aus` ist vom Browser
              // aus überhaupt änderbar.
              disabled: desktop !== 'aus',
            },
            { key: 'ton', icon: tonIkone, label: tonHinweis },
          ],
          // Die Zuordnung hängt am MENÜ, nicht je Eintrag (CLAUDE.md) — ein Ort
          // für einen etwaigen Riegel statt zweier.
          onClick: ({ key }) => {
            if (key === 'desktop') desktopAktivieren();
            else void tonUmschalten();
          },
        }}
      >
        <Button
          type="text"
          // Der zugängliche Name trägt die Gruppe UND den Zustand: „Alarmzentrale"
          // allein sagte nicht, was gerade los ist, der sichtbare Text allein
          // nicht, wozu der Knopf gehört.
          aria-label={`Alarmzentrale: ${sammelText}`}
          icon={zeigtTon ? tonIkone : desktopIkone}
          style={{ color: '#fff', flexShrink: 0 }}
        >
          {sammelText}
        </Button>
      </Dropdown>
    );
  }

  return (
    <>
      <Tooltip title={desktopHinweis}>
        <Button
          type="text"
          aria-label={`Desktop-Benachrichtigungen: ${desktopText.replace('Desktop ', '')}`}
          aria-disabled={desktop !== 'aus'}
          onClick={desktop === 'aus' ? desktopAktivieren : undefined}
          icon={desktopIkone}
          style={{ color: '#fff' }}
        >
          {desktopText}
        </Button>
      </Tooltip>
      <Tooltip title={tonHinweis}>
        <Button
          type="text"
          aria-label={tonHinweis}
          aria-pressed={gemutet}
          onClick={() => void tonUmschalten()}
          style={{ color: '#fff' }}
          icon={tonIkone}
        >
          {tonText}
        </Button>
      </Tooltip>
    </>
  );
}
