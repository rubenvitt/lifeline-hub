import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { theme } from 'antd';
import { TbAntennaBars5, TbAntennaBarsOff } from 'react-icons/tb';
import { Link } from 'react-router';
import dayjs from 'dayjs';
import { useAuth } from '../auth/AuthContext';
import { abonniereLiveStatus, leseLiveStatus } from '../live/liveStatusStore';
import type { LiveVerbindungsStatus } from '../live/useEinsatzLiveStream';
import { useOfflineQueueZaehler } from '../offline/useOfflineQueueZaehler';
import type { OfflineQueueZaehler } from '../offline/queue';
import { einsaetzePfad } from '../routing/deeplinks';
import { farbenDunkel, rahmenFarben, schrift } from '../theme/tokens';

/**
 * Bausteine der Kommandoleiste (Neuentwurf „Instrumententafel", `shell.dc.html`) — geteilt
 * von der Ebene-1-Shell (`AppLayout`) und dem Einsatz-Workspace (`EinsatzLayout`).
 *
 * DER RAHMEN IST IN BEIDEN MODI DUNKEL. Alle Farben kommen deshalb aus `rahmenFarben` bzw.
 * `farbenDunkel` und NICHT aus dem modusabhängigen antd-Token — ein Tagmodus-Wert auf dem
 * dunklen Kopfgrund verschwände (dieselbe Begründung, die `IconRail` seit A2 trägt).
 *
 * MASSE: 52 px Kopfhöhe und 60 px Markenzelle sind LAYOUTMASSE des Entwurfs, keine
 * Trefflächen. Die Kopfhöhe ist ein BODEN: in `komfortabel`/`handschuh` wachsen die
 * Bedienziele mit der Dichte-Staffel (48 / 72), und die Leiste wächst mit — gedeckelt wird
 * nie das Ziel, nur der Rahmen folgt ihm.
 */
export const KOPF_HOEHE = 52;

/** Breite der Rail und damit der Markenzelle links oben — beide fluchten im Entwurf. */
export const RAIL_BREITE = 60;

/**
 * Eine Zelle der Kommandoleiste: volle Höhe, Inhalt mittig, Haarlinie als Trenner.
 *
 * Rein und exportiert (Muster `bedienzielStil`): die Zelle ist KEIN Bedienziel, sie trägt
 * eines. Die Polsterung zieht mit der Dichte (`token.padding` = 11 / 18 / 26) — der Entwurf
 * skizziert 14 px, die Staffel ist die verbindliche Quelle.
 */
export function kopfZelleStil(
  token: { padding: number },
  trenner: 'ende' | 'anfang' | 'keiner' = 'ende',
): CSSProperties {
  const linie = `1px solid ${rahmenFarben.linie}`;
  return {
    display: 'flex',
    alignItems: 'center',
    gap: Math.round(token.padding * 0.7),
    // Zwei Langformen statt `paddingInline`: Aufrufer überschreiben eine Seite (Benutzer-
    // zelle), und React warnt, wenn Kurz- und Langform derselben Achse sich mischen.
    paddingInlineStart: token.padding,
    paddingInlineEnd: token.padding,
    minHeight: KOPF_HOEHE,
    minWidth: 0,
    boxSizing: 'border-box',
    ...(trenner === 'ende' ? { borderInlineEnd: linie } : {}),
    ...(trenner === 'anfang' ? { borderInlineStart: linie } : {}),
  };
}

/**
 * Flex-Angaben der wachsenden Kopfgruppen im Einsatz-Workspace — rein und exportiert.
 *
 * Der Einsatzname ist die Identität der Seite, das Suchfeld nur ein Auslöser. Ab `lg`
 * teilten sich beide den Überschuss früher zu gleichen Teilen (`1 1 240px` / `1 1 280px`);
 * gemessen bei 1440 px blieben dem Namen 92 px, und „Übung Hochwasser Neckartal" endete nach
 * „Übung Hoch…", während das Suchfeld 451 px breit war. Dabei deckte die Namensbasis von
 * 240 px nicht einmal den festen Teil der Gruppe (Marke 60 · Wortmarke · Nummer · Abstände,
 * gemessen ≈ 270 px in `kompakt`) — der Name lebte allein vom Überschuss.
 *
 * Jetzt (ab `lg`): die Namensgruppe startet mit 340 px (fester Teil plus gut 70 px Name)
 * und wächst dreimal so stark wie die Suche; die Suche startet bei 180 px und SCHRUMPFT
 * zuerst. Ihre Obergrenze von 520 px hält weiter `CommandPaletteTrigger`
 * (`SUCHFELD_MAX_BREITE`). Gemessen: 1440 px → Name ungekürzt.
 *
 * Die BASEN entscheiden zugleich den Umbruch (`flexWrap` am Kopf): die rechte Zellgruppe
 * wandert in eine zweite Zeile, sobald Namensbasis + Suchbasis + rechte Gruppe die Breite
 * übersteigen. Die Summe der Basen ist mit 340 + 180 = 520 px BEWUSST dieselbe wie vorher
 * (240 + 280): der Umbruch setzt also nicht früher ein als bisher (≈ 1100 px in `kompakt`),
 * das Führungs-Tablet verliert keine Zeile. Die Summe nur zu verkleinern, ginge nicht:
 * mit 240 + 160 blieb bei 992 px alles einzeilig und der Name stand gemessen auf 0 px.
 *
 * UNTER `lg` gilt {@link KOPF_NAME_FLEX_SCHMAL}, die bestehende Verdichtung: dort gibt es
 * keine Suchzelle, und eine 400-px-Basis bräche auf dem Tablet die Kopfzeile unnötig um.
 * `minWidth: 0` bleibt an allen Aufrufstellen Pflicht — ohne sie kürzt ein Flex-Kind nicht,
 * sondern läuft über (Gate 1).
 */
export const KOPF_NAME_FLEX = '3 1 340px';
export const KOPF_NAME_FLEX_SCHMAL = '1 1 240px';
export const KOPF_SUCHE_FLEX = '1 1 180px';

/** Markenzelle: 14-px-Quadrat in `marke`, in Rail-Breite. Reine Dekoration. */
export function Markenzelle() {
  return (
    <div
      aria-hidden="true"
      data-lfh="kopf-marke"
      style={{
        width: RAIL_BREITE,
        flex: `0 0 ${RAIL_BREITE}px`,
        minHeight: KOPF_HOEHE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderInlineEnd: `1px solid ${rahmenFarben.linie}`,
      }}
    >
      <div style={{ width: 14, height: 14, background: rahmenFarben.marke }} />
    </div>
  );
}

/**
 * Stil der Wortmarke — ein Link zur Einsatzliste und damit ein handgebautes Bedienziel:
 * ZWEI Angaben (LFH-365), `minHeight` aus `controlHeight` plus Polsterung. Ein `<a>` erbt
 * keine Steuerhöhe (LFH-396, gemessen 17 px) — ohne `minHeight` fiele sie unter Gate 3.
 */
export function wortmarkeStil(token: { controlHeight: number; paddingXS: number }): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingXS}px 0`,
    fontFamily: schrift.zahl,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.02em',
    color: rahmenFarben.gedaempft,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    // Auch die kurze Achse hält den Boden der Stufe (Gate 3 misst Höhe UND Breite).
    minWidth: token.controlHeight,
    justifyContent: 'center',
  };
}

/** Wortmarke `lifeline-hub` (Mono 12, gedämpft) — führt zur Einsatzliste. */
export function Wortmarke() {
  const { token } = theme.useToken();
  return (
    <Link to={einsaetzePfad()} style={wortmarkeStil(token)}>
      lifeline-hub
    </Link>
  );
}

/**
 * Ein Takt, der zur vollen Minute tickt — für Uhr und Einsatzdauer.
 *
 * Erst ein `setTimeout` bis zur nächsten Minutengrenze, danach ein Minutenintervall: ein
 * bloßes `setInterval(60 000)` ab dem Einhängen zeigte bis zu 59 s lang die alte Minute.
 * Liefert Millisekunden (primitiv, damit Konsumenten ihn in Dependency-Arrays führen dürfen).
 */
export function useMinutenTakt(): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    let intervall: ReturnType<typeof setInterval> | undefined;
    const bisZurMinute = 60_000 - (Date.now() % 60_000);
    const start = setTimeout(() => {
      setJetzt(Date.now());
      intervall = setInterval(() => setJetzt(Date.now()), 60_000);
    }, bisZurMinute);
    return () => {
      clearTimeout(start);
      if (intervall) clearInterval(intervall);
    };
  }, []);
  return jetzt;
}

/** Uhrzeit HH:MM in Browserzeit. */
export function formatiereUhr(ms: number): string {
  return dayjs(ms).format('HH:mm');
}

/**
 * Die Uhr der Kommandoleiste (Mono 14/500). Browserzeit, nicht die Anzeigezone eines
 * Einsatzes: der Kopf liegt AUSSERHALB des `EinsatzAnzeigeProvider` und steht auch auf der
 * Einsatzliste, wo es keine Einsatzzone gibt. Eine Uhr, die je Route die Zone wechselt,
 * wäre schlimmer als eine, die immer die Ortszeit des Geräts zeigt.
 */
export function Uhr() {
  const { token } = theme.useToken();
  const jetzt = useMinutenTakt();
  const text = formatiereUhr(jetzt);
  return (
    <div data-lfh="kopf-uhr" style={kopfZelleStil(token)}>
      <time
        dateTime={dayjs(jetzt).format('HH:mm')}
        aria-label={`Uhrzeit ${text}`}
        style={{
          fontFamily: schrift.zahl,
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: '0.04em',
          fontVariantNumeric: 'tabular-nums',
          color: rahmenFarben.text,
        }}
      >
        {text}
      </time>
    </div>
  );
}

/**
 * Die Zustände der SYNC-Anzeige. `ruhe` heißt „nichts zu melden UND keine Live-Verbindung
 * erwartet" — auf der Einsatzliste läuft kein SSE-Strom, ein dauerhaftes „verbinde …" dort
 * wäre eine Falschmeldung.
 */
export type SyncZustand =
  'verbunden' | 'verbinde' | 'getrennt' | 'offline' | 'ausstehend' | 'abgelehnt' | 'ruhe';

/**
 * Leitet den Zustand ab — REIN und exportiert, damit die Rangfolge ohne Rendern prüfbar ist.
 *
 * Rangfolge: was Daten gefährdet, geht vor dem, was nur verzögert. `offline` vor `getrennt`
 * (ohne Netz ist der Strom zwangsläufig weg — der Grund ist der Netzverlust), abgelehnte
 * Offline-Aktionen vor dem Verbindungsaufbau (sie verlangen eine Handlung), ausstehende
 * nach dem Aufbau (sie gehen von selbst hinaus, sobald er steht).
 *
 * `idle` ist der Zustand VOR dem ersten Verbindungsversuch — im Einsatz also „verbinde",
 * nie „getrennt": sonst meldete jeder Kaltstart Alarm.
 */
export function syncZustand(eingabe: {
  online: boolean;
  live: LiveVerbindungsStatus;
  liveErwartet: boolean;
  queue: OfflineQueueZaehler;
}): SyncZustand {
  const { online, live, liveErwartet, queue } = eingabe;
  if (!online) return 'offline';
  if (queue.abgelehnt > 0) return 'abgelehnt';
  if (liveErwartet && live === 'lost') return 'getrennt';
  if (liveErwartet && (live === 'connecting' || live === 'idle')) return 'verbinde';
  if (queue.ausstehend > 0) return 'ausstehend';
  if (liveErwartet && live === 'open') return 'verbunden';
  return 'ruhe';
}

interface SyncDarstellung {
  /** Sichtbares Wort (Mono, Versalien) — der zweite Kanal neben der Farbe (WCAG 1.4.1). */
  wort: string;
  /** Vollständiger Satz für den zugänglichen Namen. */
  satz: (queue: OfflineQueueZaehler) => string;
  farbe: string;
  getrennt: boolean;
}

/**
 * Wort, Satz und Farbe je Zustand. Die Farben sind die NACHT-Rollen, weil der Kopf in beiden
 * Modi dunkel ist: `normal` für die stehende Verbindung, `achtung` für Verzug, `alarm` für
 * Verlust. Rot bedient hier nichts — die Anzeige ist ein Zustand, kein Knopf.
 */
export const SYNC_DARSTELLUNG: Record<Exclude<SyncZustand, 'ruhe'>, SyncDarstellung> = {
  verbunden: {
    wort: 'SYNC',
    satz: () => 'Live-Verbindung steht',
    farbe: farbenDunkel.normal,
    getrennt: false,
  },
  verbinde: {
    wort: 'VERBINDE',
    satz: () => 'Live-Verbindung wird aufgebaut',
    farbe: farbenDunkel.achtung,
    getrennt: false,
  },
  ausstehend: {
    wort: 'QUEUE',
    satz: (q) => `${q.ausstehend} Offline-Aktionen ausstehend`,
    farbe: farbenDunkel.achtung,
    getrennt: false,
  },
  getrennt: {
    wort: 'GETRENNT',
    satz: () => 'Live-Verbindung unterbrochen — die Anzeige kann veraltet sein',
    farbe: farbenDunkel.alarm,
    getrennt: true,
  },
  offline: {
    wort: 'OFFLINE',
    satz: () => 'Offline — keine Verbindung zum Server',
    farbe: farbenDunkel.alarm,
    getrennt: true,
  },
  abgelehnt: {
    wort: 'PRÜFEN',
    satz: (q) => `${q.abgelehnt} Offline-Aktionen abgelehnt — bitte prüfen`,
    farbe: farbenDunkel.alarm,
    getrennt: false,
  },
};

/** `navigator.onLine` als reaktiver Wert. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const an = () => setOnline(true);
    const aus = () => setOnline(false);
    window.addEventListener('online', an);
    window.addEventListener('offline', aus);
    return () => {
      window.removeEventListener('online', an);
      window.removeEventListener('offline', aus);
    };
  }, []);
  return online;
}

/**
 * SYNC-Anzeige: Antennen-Ikone + Wort (Mono 11). Eine ANZEIGE, kein Bedienziel — die
 * Handlungen (Neu laden, abgelehnte Aktionen prüfen) trägt weiter die Betriebszeile
 * (`LiveStatusBanner`), die dieselbe Quelle liest. Zwei Anzeigen, EIN Store (LFH-336 · M3).
 *
 * `liveErwartet`: nur der Einsatz-Workspace hält einen SSE-Strom. Auf der Einsatzliste ist
 * der Store dauerhaft `idle`; dort erscheint die Zelle nur bei Netzverlust oder offener Queue.
 *
 * `kompakt` (unter `md`): nur Ikone, das Wort wandert in den zugänglichen Namen und `title`.
 *
 * `ruheOhneWort` (zwischen `md` und `xl`, Führungs-Tablet): nur der RUHEZUSTAND „SYNC" steht
 * als Ikone — er ist der Normalfall und kostete bei 1024 px die Einzeiligkeit des Kopfes.
 * Jede Störung (VERBINDE, QUEUE, GETRENNT, OFFLINE, PRÜFEN) behält ihr Wort: sie soll
 * auffallen, und Farbe allein wäre ein Kanal (WCAG 1.4.1).
 */
export function syncZeigtWort(
  zustand: Exclude<SyncZustand, 'ruhe'>,
  kompakt: boolean,
  ruheOhneWort: boolean,
): boolean {
  if (kompakt) return false;
  return !(ruheOhneWort && zustand === 'verbunden');
}

export function SyncAnzeige({
  liveErwartet,
  kompakt = false,
  ruheOhneWort = false,
}: {
  liveErwartet: boolean;
  kompakt?: boolean;
  ruheOhneWort?: boolean;
}) {
  const { token } = theme.useToken();
  const { benutzer } = useAuth();
  const live = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);
  const online = useOnline();
  const queue = useOfflineQueueZaehler(benutzer?.id);
  const zustand = syncZustand({ online, live, liveErwartet, queue });
  if (zustand === 'ruhe') return null;
  const d = SYNC_DARSTELLUNG[zustand];
  const Icon = d.getrennt ? TbAntennaBarsOff : TbAntennaBars5;
  const satz = d.satz(queue);
  const wort = zustand === 'ausstehend' ? `${d.wort} ${queue.ausstehend}` : d.wort;
  return (
    <div
      data-lfh="kopf-sync"
      data-zustand={zustand}
      // `img` und NICHT `status`: die Betriebszeile (`LiveStatusBanner`) meldet dieselben
      // Zustände aus demselben Store bereits an — eine zweite Live-Region sagte jede
      // Störung doppelt an (Alarmbudget, EEMUA 191). Hier nur Name und `title`.
      role="img"
      aria-label={satz}
      title={satz}
      style={kopfZelleStil(kompakt ? { padding: token.paddingXS } : token)}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', color: d.farbe }}>
        <Icon size={16} />
      </span>
      {syncZeigtWort(zustand, kompakt, ruheOhneWort) && (
        <span
          aria-hidden="true"
          style={{
            fontFamily: schrift.zahl,
            fontSize: 11,
            // Verbunden bleibt das Wort gedämpft wie im Entwurf — die grüne Ikone trägt den
            // Zustand. Jede Störung färbt auch das Wort: dann soll es auffallen.
            color: zustand === 'verbunden' ? rahmenFarben.gedaempft : d.farbe,
          }}
        >
          {wort}
        </span>
      )}
    </div>
  );
}

/** Rechte Zellgruppe der Kommandoleiste: bricht als Ganzes um, nicht zellweise. */
export function KopfRechts({ children }: { children: ReactNode }) {
  return (
    <div
      data-lfh="kopf-rechts"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        marginInlineStart: 'auto',
        borderInlineStart: `1px solid ${rahmenFarben.linie}`,
        flexShrink: 0,
        maxWidth: '100%',
        // `wrap` als Sicherheitsnetz, nicht als Regelfall: die Gruppe bricht als GANZES in
        // eine eigene Kopfzeile um (Header-`wrap`); nur wenn sie selbst breiter ist als der
        // Schirm (390 px in `handschuh`), dürfen ihre Zellen umbrechen — sonst liefe die
        // Leiste waagerecht über (Gate 1), was schwerer wiegt als eine weitere Zeile.
        flexWrap: 'wrap',
      }}
    >
      {children}
    </div>
  );
}
