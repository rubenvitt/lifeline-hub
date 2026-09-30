import { IkoneFunkbalken, IkoneFunkbalkenAus } from '../ikonen';
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { theme } from 'antd';
import { Link } from 'react-router';
import dayjs from 'dayjs';
import { useAuth } from '../auth/AuthContext';
import { Bildmarke } from '../marke/Bildmarke';
import { abonniereLiveStatus, leseLiveStatus } from '../live/liveStatusStore';
import type { LiveVerbindungsStatus } from '../live/useEinsatzLiveStream';
import { useOfflineQueueZaehler } from '../offline/useOfflineQueueZaehler';
import { useOnline } from '../offline/useOnline';
import type { OfflineQueueZaehler } from '../offline/queue';
import { einsaetzePfad } from '../routing/deeplinks';
import { farbenDunkel, rahmenFarben, schrift } from '../theme/tokens';

/**
 * Bausteine der Kommandoleiste (`shell.dc.html`) — geteilt von der Ebene-1-Shell (`AppLayout`)
 * und dem Einsatz-Workspace (`EinsatzLayout`).
 *
 * DER RAHMEN IST IN BEIDEN MODI DUNKEL. Alle Farben kommen deshalb aus `rahmenFarben` bzw.
 * `farbenDunkel`, NICHT aus dem modusabhängigen antd-Token.
 *
 * MASSE: 52 px Kopfhöhe und 60 px Markenzelle sind LAYOUTMASSE, keine Trefflächen. Beide sind
 * BÖDEN: in `komfortabel`/`handschuh` wachsen die Bedienziele (48 / 72), und der Rahmen wächst
 * mit — die Markenzelle folgt der Rail-Spalte ({@link railBreite}, LFH-384).
 */
export const KOPF_HOEHE = 52;
/** Höhe der Bildmarke in der Markenzelle (LFH-837; vorher ein 14-px-Quadrat). */
export const MARKENZELLE_BILDMARKE_HOEHE = 22;

/**
 * Breite der Rail und damit der Markenzelle links oben — beide fluchten im Entwurf. Die
 * 60 px sind ein BODEN, nicht die Breite: gelesen wird immer {@link railBreite}.
 */
const RAIL_BREITE = 60;

/** Die Haarlinie rechts an Rail und Markenzelle; sie geht in der Spalte vom Ziel ab. */
const RAIL_LINIE = 1;

/**
 * Breite der Rail-Spalte zur Dichtestufe (LFH-384): die Entwurfsbreite als Boden, darüber
 * wächst sie mit, bis das Kategorie-Ziel auch in der BREITE `controlHeight` hält — in
 * `handschuh` 73 px (72 Ziel + Haarlinie), sonst 60. Entscheidung des Auftraggebers vom
 * 29.09.2026: die Spalte wächst, statt die Breite als Dauerausnahme festzuschreiben; der
 * Preis sind 13 px Inhalt, und nur in der Stufe, die man bewusst wählt. REIN und exportiert,
 * damit die Zusicherung ohne Rendern prüfbar ist (antds Seed im Vitest kennt die Staffel nicht).
 */
export function railBreite(token: { controlHeight: number }): number {
  return Math.max(RAIL_BREITE, token.controlHeight + RAIL_LINIE);
}

/**
 * Eine Zelle der Kommandoleiste: volle Höhe, Inhalt mittig, Haarlinie als Trenner.
 *
 * Rein und exportiert (Muster `bedienzielStil`): die Zelle ist KEIN Bedienziel, sie trägt eines.
 * Die Polsterung zieht mit der Dichte (`token.padding`); die Staffel ist die verbindliche Quelle,
 * nicht der Entwurfswert.
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
 * Der Einsatzname ist die Identität der Seite, das Suchfeld nur ein Auslöser. Ab `lg` startet
 * die Namensgruppe mit 340 px (fester Teil aus Marke, Wortmarke, Nummer ≈ 270 px plus Name) und
 * wächst dreimal so stark wie die Suche; die Suche startet bei 180 px und SCHRUMPFT zuerst. Ihre
 * Obergrenze hält `CommandPaletteTrigger` (`SUCHFELD_MAX_BREITE`).
 *
 * Die BASEN entscheiden zugleich den Umbruch (`flexWrap` am Kopf): die rechte Zellgruppe wandert
 * in eine zweite Zeile, sobald Namensbasis + Suchbasis + rechte Gruppe die Breite übersteigen.
 * Die Summe 340 + 180 = 520 px hält den Umbruchpunkt (≈ 1100 px in `kompakt`); kleiner würde der
 * Name bei mittleren Breiten auf 0 px gedrückt.
 *
 * UNTER `lg` gilt {@link KOPF_NAME_FLEX_SCHMAL}: dort gibt es keine Suchzelle. `minWidth: 0`
 * bleibt an allen Aufrufstellen Pflicht — ohne sie kürzt ein Flex-Kind nicht, sondern läuft
 * über (Gate 1).
 */
export const KOPF_NAME_FLEX = '3 1 340px';
export const KOPF_NAME_FLEX_SCHMAL = '1 1 240px';
export const KOPF_SUCHE_FLEX = '1 1 180px';

/**
 * Markenzelle: Bildmarke „Lebenslinie“ (LFH-837) in der Textfarbe des Rahmens, in Rail-Breite.
 * Reine Dekoration; den Namen trägt die Wortmarke daneben.
 */
export function Markenzelle() {
  const { token } = theme.useToken();
  const breite = railBreite(token);
  return (
    <div
      aria-hidden="true"
      data-lfh="kopf-marke"
      style={{
        width: breite,
        flex: `0 0 ${breite}px`,
        minHeight: KOPF_HOEHE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderInlineEnd: `1px solid ${rahmenFarben.linie}`,
      }}
    >
      <Bildmarke hoehe={MARKENZELLE_BILDMARKE_HOEHE} linienFarbe={rahmenFarben.text} />
    </div>
  );
}

/**
 * Stil der Wortmarke — ein Link zur Einsatzliste und damit ein handgebautes Bedienziel: ZWEI
 * Angaben (LFH-365), `minHeight` aus `controlHeight` plus Polsterung. Ein `<a>` erbt keine
 * Steuerhöhe.
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
 * Erst ein `setTimeout` bis zur nächsten Minutengrenze, danach ein Minutenintervall; ein bloßes
 * `setInterval(60 000)` zeigte bis zu 59 s die alte Minute. Liefert Millisekunden (primitiv, für
 * Dependency-Arrays).
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
 * Die Uhr der Kommandoleiste (Mono 14/500). Browserzeit, nicht die Anzeigezone eines Einsatzes:
 * der Kopf liegt AUSSERHALB des `EinsatzAnzeigeProvider` und steht auch auf der Einsatzliste.
 * Eine Uhr, die je Route die Zone wechselt, wäre schlimmer.
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
 * erwartet" — auf der Einsatzliste läuft kein SSE-Strom.
 */
type SyncZustand =
  'verbunden' | 'verbinde' | 'getrennt' | 'offline' | 'ausstehend' | 'abgelehnt' | 'ruhe';

/**
 * Leitet den Zustand ab — REIN und exportiert, damit die Rangfolge ohne Rendern prüfbar ist.
 *
 * Was Daten gefährdet, geht vor dem, was nur verzögert: `offline` vor `getrennt` (ohne Netz ist
 * der Strom zwangsläufig weg), abgelehnte Offline-Aktionen vor dem Verbindungsaufbau (sie
 * verlangen eine Handlung), ausstehende danach (sie gehen von selbst hinaus).
 *
 * `idle` ist der Zustand VOR dem ersten Verbindungsversuch — im Einsatz „verbinde", nie
 * „getrennt", sonst meldete jeder Kaltstart Alarm.
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
 * Verlust. Die Anzeige ist ein Zustand, kein Knopf.
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
    farbe: rahmenFarben.alarm,
    getrennt: true,
  },
  offline: {
    wort: 'OFFLINE',
    satz: () => 'Offline — keine Verbindung zum Server',
    farbe: rahmenFarben.alarm,
    getrennt: true,
  },
  abgelehnt: {
    wort: 'PRÜFEN',
    satz: (q) => `${q.abgelehnt} Offline-Aktionen abgelehnt — bitte prüfen`,
    farbe: rahmenFarben.alarm,
    getrennt: false,
  },
};

/**
 * SYNC-Anzeige: Antennen-Ikone + Wort (Mono 11). Eine ANZEIGE, kein Bedienziel — die Handlungen
 * trägt die Betriebszeile (`LiveStatusBanner`) aus demselben Store (LFH-336 · M3).
 *
 * `liveErwartet`: nur der Einsatz-Workspace hält einen SSE-Strom. Auf der Einsatzliste erscheint
 * die Zelle nur bei Netzverlust oder offener Queue.
 *
 * `kompakt` (unter `md`): nur Ikone, das Wort wandert in den zugänglichen Namen und `title`.
 *
 * `ruheOhneWort` (zwischen `md` und `xl`): nur der RUHEZUSTAND „SYNC" steht als Ikone. Jede
 * Störung (VERBINDE, QUEUE, GETRENNT, OFFLINE, PRÜFEN) behält ihr Wort — Farbe allein wäre ein
 * Kanal (WCAG 1.4.1).
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
  const Icon = d.getrennt ? IkoneFunkbalkenAus : IkoneFunkbalken;
  const satz = d.satz(queue);
  const wort = zustand === 'ausstehend' ? `${d.wort} ${queue.ausstehend}` : d.wort;
  return (
    <div
      data-lfh="kopf-sync"
      data-zustand={zustand}
      // `img` und NICHT `status`: die Betriebszeile meldet dieselben Zustände schon an, eine zweite
      // Live-Region sagte jede Störung doppelt an (EEMUA 191).
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
        // `wrap` als Sicherheitsnetz: die Gruppe bricht als GANZES in eine eigene Kopfzeile um; nur wenn
        // sie selbst breiter ist als der Schirm, brechen ihre Zellen um — sonst liefe die Leiste
        // waagerecht über (Gate 1).
        flexWrap: 'wrap',
      }}
    >
      {children}
    </div>
  );
}
