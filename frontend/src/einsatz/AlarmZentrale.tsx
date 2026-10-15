import {
  IconGlocke,
  IconGlockeAus,
  IconHakenKreis,
  IconMonitor,
  IconVerbotsschild,
} from '../icons';
import { Button, Dropdown, Tooltip, theme } from 'antd';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  DESKTOP_ZUSTAND_EVENT,
  desktopPermission,
  fordereDesktopPermission,
  schliesseAlleDesktopAlarme,
  schliesseDesktopAlarm,
} from '../alarm/desktopAlarm';
import { useAlarmToasts } from '../alarm/useAlarmToasts';
import { quittiereNachNutzer, useBenachrichtigungen } from '../alarm/useBenachrichtigungen';
import { wetterPegelPfad } from '../routing/deeplinks';
import { WortPlatz } from '../components/Kopfleiste';
import { useViewport } from '../components/useViewport';
import { useDichte } from '../theme/ThemeModeProvider';
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

/**
 * Wort der gebündelten Marke. Auf dem Handschirm ab 48 px Steuerhöhe steht jedes Wort auf eigener
 * Zeile und die Marke ist so breit wie ihr längstes Wort: „Benachrichtigung blockiert“ machte die
 * Kopfgruppe auf 390 px in Handschuh-Dichte so breit wie den Schirm, sie brach auf zwei Kopfzeilen
 * um, und der Wechsel auf „Ton blockiert“ ließ die Seite 72 px springen (LFH-1108). In `kompakt`
 * hätten zwei Zeilen in 30 px keinen Platz. Auf dem Tablet bleibt das Wort einzeilig: dort hält
 * die rechte Gruppe den Platz, den der Einsatzname für seine Trefffläche braucht.
 */
export function sammelWortStil(steuerHoehe: number, schmal: boolean): CSSProperties {
  if (!schmal || steuerHoehe < 48) return {};
  return { whiteSpace: 'normal', width: 'min-content', lineHeight: 1.25, textAlign: 'start' };
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

/** Längster Wortlaut des Ton-Knopfs; das Wort hält seine Breite (LLH-1158). */
const TON_WORT_LAENGSTES = 'Ton wird geprüft';

/**
 * Zustand der Benachrichtigungen (LFH-950). `nicht-verfuegbar` ist eine Eigenschaft des Geräts
 * (iOS-Safari ohne installierte PWA, Chromium auf Android), keine Störung: ohne Warnfarbe.
 */
type DesktopZustand = 'aus' | 'erlaubt' | 'blockiert' | 'nicht-verfuegbar';

/**
 * Tonzustand der Anzeige (LFH-637). `prueft` gilt, bis die Audio-Prüfung zum ersten Mal
 * antwortet: „blockiert" hieße dort etwas, das niemand festgestellt hat, und das Wort brach beim
 * Start die Kopfzeile bei 1024 px um (CLS 0,46). `prueft` ist keine Störung, steht also wie der
 * Ruhezustand: gedämpft, ohne durchgestrichene Glocke, zwischen `md` und `xl` ohne Wort (außer in
 * `handschuh`, LLH-1232). Seit LFH-950 dauert es höchstens `ALARM_TON_FRIST_MS`: ohne Antwort
 * meldet `alarmTon` danach „blockiert", ein dauerhaftes „prüft" verdeckte sonst einen stummen
 * Alarm.
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
 * Einsatzweite Benachrichtigungszentrale (design.md D5): zeigt die Benachrichtigungen des
 * Servers (`alarm/useBenachrichtigungen.ts`), darunter seit LLH-1209 auch Sofortmeldung,
 * überfälliger Auftrag, fällige Erinnerung und Ablösung, sowie `lfh:unwetter-alarm` (vom Rahmen,
 * `wetter/useUnwetterHinweis.ts`; die Wetterwarnung erkennt der Browser selbst). Alle teilen EIN Budget nicht selbst-schließender Toasts mit
 * Deeplink zur Quelle (`alarm/useAlarmToasts.tsx`), optional eine OS-Meldung bei Hintergrund-Tab.
 * EIN globaler Mute (Per-User, localStorage) schaltet ALLE Alarmtöne. Im Layout-Kopf montiert,
 * wirkt also seitenunabhängig; die Einsatz-ID reicht der Rahmen schon geprüft herein (LFH-438).
 * Toasts über `App.useApp().notification` (kein statischer Import, sonst Kontext-Leak in Tests).
 */
export default function AlarmZentrale({ einsatzId }: { einsatzId: number }) {
  const [gemutet, setGemutet] = useState(istAlarmGemutet());
  const [permission, setPermission] = useState(desktopPermission());
  const [tonStatus, setTonStatus] = useState<TonZustand>(alarmTonStatus() ?? 'prueft');
  // Das gemeinsame Budget (`alarm/useAlarmToasts.tsx`): Benachrichtigungen und Unwetter teilen es.
  const toasts = useAlarmToasts(einsatzId, quittiereNachNutzer);
  useBenachrichtigungen(einsatzId, toasts);
  // Jede Unwetter-Auslösung bekommt einen eigenen Schlüssel.
  const zaehlerRef = useRef(0);
  /** Letzter Unwetterhinweis dieses Einsatzes: ein neuer ersetzt ihn (ein Platz im Budget). */
  const unwetterRef = useRef<{ einsatzId: number; schluessel: string; tag: string } | null>(null);

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
    // Der Service Worker bestätigt den zweiten Weg erst nach dem Mount (LFH-1062).
    const neuLesen = () => setPermission(desktopPermission());
    window.addEventListener('focus', aktualisieren);
    document.addEventListener('visibilitychange', aktualisieren);
    window.addEventListener(DESKTOP_ZUSTAND_EVENT, neuLesen);
    return () => {
      window.removeEventListener('focus', aktualisieren);
      document.removeEventListener('visibilitychange', aktualisieren);
      window.removeEventListener(DESKTOP_ZUSTAND_EVENT, neuLesen);
    };
  }, []);

  // Neue Unwetterwarnung am Einsatzort (LFH-663,
  // `openspec/changes/archive/2026-10-01-lfh-663-unwetterwarnung-alarmbudget/design.md` D1/D6). Kein Live-Ereignis:
  // der Rahmen erkennt „neu" selbst, prüft die Einstellung `unwetter` und meldet es hierher, der
  // Ton spielt dort. Die Stufe ist Hinweis (design.md D4). Ein neuer Hinweis
  // ERSETZT einen noch einzeln sichtbaren älteren — das Wetter belegt nie mehr als einen der drei
  // Plätze. Eigener Schlüssel je Auslösung, damit „schon gebündelt" ihn nie verschluckt.
  useEffect(() => {
    const onUnwetter = (ev: Event) => {
      const detail = (ev as CustomEvent<UnwetterDetail>).detail ?? {};
      const paar = detail.schluessel ?? 'ohne';
      const schluessel = `unwetter-${paar}-${++zaehlerRef.current}`;
      const vorher = unwetterRef.current?.einsatzId === einsatzId ? unwetterRef.current : null;
      if (vorher && toasts.istEinzeln(vorher.schluessel)) toasts.entferne(vorher.schluessel);
      // Die OS-Meldung zieht mit dem Toast gleich (LFH-951): die neue ersetzt die ältere, auch
      // wenn das Paar ein anderes ist. Dasselbe Paar ersetzt sie schon über den `tag`.
      const tag = `${einsatzId}-unwetter-${paar}`;
      if (vorher && vorher.tag !== tag) schliesseDesktopAlarm(vorher.tag);
      unwetterRef.current = { einsatzId, schluessel, tag };
      toasts.melde({
        schluessel,
        art: 'warning',
        titel: detail.titel ?? 'Unwetterwarnung',
        beschreibung: detail.beschreibung ?? 'Unwetterwarnung für den Einsatzort',
        pfad: wetterPegelPfad(einsatzId),
        ziel: 'wetter-pegel',
        gruppe: 'unwetter',
        name: 'Unwetterwarnung',
        stufe: 'hinweis',
        desktop: { tag },
      });
    };
    window.addEventListener('lfh:unwetter-alarm', onUnwetter);
    return () => window.removeEventListener('lfh:unwetter-alarm', onUnwetter);
  }, [einsatzId, toasts]);

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
  const { token } = theme.useToken();
  const knapp = !abBreite('xl');
  const { dichte } = useDichte();
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
  // Name des breiten Knopfs nach dem Muster des Ton-Knopfs: der sichtbare Zustand wortgleich vorn
  // (WCAG 2.5.3, LFH-1103), die Handlung nur, wo der Knopf eine hat — allein `aus` ist änderbar.
  const desktopName = desktop === 'aus' ? `${desktopText} – aktivieren` : desktopText;
  const tonText = gemutet
    ? 'Ton stumm'
    : tonStatus === 'bereit'
      ? 'Ton bereit'
      : tonStatus === 'prueft'
        ? TON_WORT_LAENGSTES
        : 'Ton blockiert';
  const tonHandlung = gemutet
    ? 'einschalten'
    : tonStatus === 'bereit'
      ? 'stummschalten'
      : 'freischalten';
  // Name und Tooltip des Knopfs: der sichtbare Zustand wortgleich vorn, dann die Handlung
  // (WCAG 2.5.3, LFH-1102): Spracheingabe mit „Ton blockiert“ trifft den Knopf. Keine Geste im
  // Text (LFH-1078): Maus und Tastatur tippen nicht.
  const tonHinweis = `${tonText} – ${tonHandlung}`;
  // Menüeintrag: Zustand UND Handlung als ein Satz — dort steht kein Tooltip daneben, und der
  // sichtbare Text ist der Name.
  const tonSatz = gemutet
    ? 'Alarmton ist stumm – einschalten'
    : tonStatus === 'bereit'
      ? 'Alarmton ist bereit – stummschalten'
      : tonStatus === 'prueft'
        ? 'Alarmton wird geprüft – freischalten'
        : 'Alarmton blockiert – freischalten';

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
          {istSchmal || sammelAuffaellig ? (
            <span style={sammelWortStil(token.controlHeight, istSchmal)}>{sammelText}</span>
          ) : null}
        </Button>
      </Dropdown>
    );
  }

  const desktopWort = knapp && !desktopAuffaellig ? null : desktopText;
  // Ab `xl` hält das Wort die Breite von „Ton wird geprüft“ (LLH-1158, `WortPlatz`): die
  // Tonprüfung beim Start wechselt den Wortlaut ohne Zutun, und an der Umbruchgrenze sprang der
  // Kopf mit dem kürzeren Wort von zwei Zeilen auf eine. Darunter steht die Prüfung nur als Icon;
  // der Platz machte „Ton blockiert“ breiter, und der Kopf brach bei 1024 px um (LFH-637).
  // In `handschuh` gilt das auch unter `xl` (LLH-1232): dort ist der Kopf bei 1100 und ab
  // 1200 px ohnehin zweizeilig, und nur das Wort mit Platz hält ihn über „Ton bereit“ und „Ton
  // blockiert“ gleich hoch.
  const tonHaeltPlatz = !knapp || dichte === 'handschuh';
  const tonWort = !tonHaeltPlatz && !tonAuffaellig ? null : tonText;

  return (
    <>
      <Tooltip title={desktopWort ? desktopHinweis : `${desktopText} — ${desktopHinweis}`}>
        <Button
          type="text"
          aria-label={desktopName}
          aria-disabled={desktop !== 'aus'}
          onClick={desktop === 'aus' ? desktopAktivieren : undefined}
          icon={desktopIcon}
          style={{ color: alarmKnopfFarbe(desktopAuffaellig), fontSize: 12 }}
        >
          {desktopWort}
        </Button>
      </Tooltip>
      <Tooltip title={tonHinweis}>
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
          {tonWort ? (
            <WortPlatz platz={tonHaeltPlatz ? TON_WORT_LAENGSTES : ''}>{tonWort}</WortPlatz>
          ) : null}
        </Button>
      </Tooltip>
    </>
  );
}
