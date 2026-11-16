import { IconWlanVerbunden, IconWlanGetrennt } from '../icons';
import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { theme } from 'antd';
import { Link } from 'react-router';
import dayjs from 'dayjs';
import { useAuth } from '../auth/AuthContext';
import { Bildmarke } from '../marke/Bildmarke';
import { abonniereLiveStatus, leseLiveStatus } from '../live/liveStatusStore';
import type { LiveVerbindungsStatus } from '../live/liveVerbindung';
import { useOfflineQueueZaehler } from '../offline/useOfflineQueueZaehler';
import { useOnline } from '../offline/useOnline';
import { useMinutenTakt } from './useMinutenTakt';
import { anzahl } from '../anzeige/anzahl';
import type { OfflineQueueZaehler } from '../offline/queue';
import { einsaetzePfad } from '../routing/deeplinks';
import { farbenDunkel, rahmenFarben, schrift, schriftPx } from '../theme/tokens';
import { schriftGroesse, schriftStil } from './instrument/rollenwerte';

/**
 * Bausteine der Kommandoleiste (`shell.dc.html`) — geteilt von der Ebene-1-Shell (`AppLayout`)
 * und dem Einsatz-Workspace (`EinsatzLayout`).
 *
 * DER RAHMEN IST IN BEIDEN MODI DUNKEL. Alle Farben kommen deshalb aus `rahmenFarben` bzw.
 * `farbenDunkel`, NICHT aus dem modusabhängigen antd-Token.
 *
 * MASSE: 52 px Kopfhöhe und 64 px Markenzelle sind LAYOUTMASSE, keine Trefflächen. Beide sind
 * BÖDEN: in `komfortabel`/`handschuh` wachsen die Bedienziele (48 / 72), und der Rahmen wächst
 * mit — die Markenzelle folgt der Rail-Spalte ({@link railBreite}, LFH-384).
 */
export const KOPF_HOEHE = 52;
/** Höhe der Bildmarke in der Markenzelle (LFH-837; vorher ein 14-px-Quadrat). */
export const MARKENZELLE_BILDMARKE_HOEHE = 22;

/**
 * Breite der Rail und damit der Markenzelle links oben in `kompakt` — beide fluchten im Entwurf.
 * Ein BODEN, nicht die Breite: gelesen wird immer {@link railBreite}. 64 statt der 60 des Entwurfs
 * (LLH-1773): das Rail-Etikett steht seit 15.11.2026 in 11 statt 9 px, „FÜHRUNG“ misst 58,5 px.
 */
const RAIL_BREITE = 64;

/** Die Haarlinie rechts an Rail und Markenzelle; sie geht in der Spalte vom Ziel ab. */
const RAIL_LINIE = 1;

/**
 * Breite der Rail-Spalte zur Dichtestufe (LFH-384): sie wächst mit der Schrift der Stufe
 * (`RAIL_BREITE` × Faktor der Grundschrift, LLH-1774: 64 / 74 / 80 px), damit das Rail-Etikett
 * in jeder Stufe hineinpasst, und nie unter das Kategorie-Ziel in der BREITE `controlHeight`
 * plus Haarlinie. Entscheidung des Auftraggebers vom 29.09.2026 (die Spalte wächst, statt eine
 * Dauerausnahme festzuschreiben), fortgeschrieben am 16.11.2026 (Rail wächst mit der Schrift).
 * REIN und exportiert, damit die Zusicherung ohne Rendern prüfbar ist.
 */
export function railBreite(token: { controlHeight: number; fontSize: number }): number {
  const mitSchrift = Math.round((RAIL_BREITE * token.fontSize) / schriftPx('text'));
  return Math.max(mitSchrift, token.controlHeight + RAIL_LINIE);
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
 * Kopfgruppen im Einsatz-Workspace — rein und exportiert.
 *
 * Der Einsatzname ist die Identität der Seite, das Suchfeld nur ein Auslöser. AB `lg` liegen
 * Namensgruppe und Suche in EINEM Raster ({@link kopfRasterSpalten}, LLH-1726, Spec `kopfleiste`):
 * die Namensspalte bekommt ihre Eigenbreite (`max-content`, der ganze Name), bevor die Suche
 * (`1fr`) mehr als ihre Lupe bekommt. Reicht die Breite nicht, steht die Suche auf ihrem Minimum,
 * und erst dann kürzt der Name. Eine Wachstumsquote (vorher `3 1 340px` gegen `1 1 136px`) konnte
 * das nicht ausdrücken: sie verteilt anteilig, und bei 1280 px blieben dem Namen 50 px.
 *
 * Der Behälter nimmt als EIN Flex-Element am Umbruch teil (`flexWrap` am Kopf), mit der Basis
 * aus {@link kopfNameSucheFlex}: die rechte Zellgruppe wandert in eine zweite Zeile, sobald Basis
 * plus rechte Gruppe die Breite übersteigen. Sein Boden ist `min-content`: fester Teil der
 * Namensgruppe plus Trefffläche des Namens (LFH-1126) plus Lupe. Die Basis hängt NIE am geladenen
 * Namen: sonst bekäme der Kopf nach dem Laden eine Zeile mehr (Spec `einsatztauglichkeit-layout`,
 * „Der App-Rahmen springt beim Laden nicht“).
 *
 * UNTER `lg` gilt {@link KOPF_NAME_FLEX_SCHMAL}: dort gibt es keine Suchzelle. Ein Flex-Kind mit
 * Text braucht einen Boden, sonst kürzt es nicht, sondern läuft über (Gate 1): die Namensgruppe
 * `minWidth: 'min-content'`, der Name darin bricht für die Messung an jeder Stelle
 * (`EinsatzSwitcher`), die Namenszelle hält die Trefffläche als Boden (`EinsatzLayout`).
 */
export const KOPF_NAME_FLEX_SCHMAL = '1 1 196px';

/**
 * Basis in `kompakt`: die Summe der alten Basen (340 + 136), damit der Umbruch dort bleibt, wo er
 * war. Mit der Dichte wächst der feste Teil der Namensgruppe (Marke, Nummernzelle, Trefffläche)
 * und die Lupe; die Basis wächst um das Vierfache der Steuerhöhe über 30 px mit (komfortabel 548,
 * handschuh 644). In `handschuh` bricht die rechte Gruppe (fünf 72-px-Ziele, Uhr, Benutzer ≈ 580
 * px) so bis 1224 px um, statt den Namen auf 180 px zu drücken (LLH-1726, vorher „ÜBUNG – Sta…“
 * bei 1180 px). Der Kopf ist dort zweizeilig, wie er es vorher auch war.
 */
const KOPF_NAME_SUCHE_BASIS = 476;
const KOPF_STEUERHOEHE_KOMPAKT = 30;

export function kopfNameSucheFlex(token: { controlHeight: number }): string {
  return `1 1 ${KOPF_NAME_SUCHE_BASIS + 4 * (token.controlHeight - KOPF_STEUERHOEHE_KOMPAKT)}px`;
}

/**
 * Spalten des Rasters aus Namensgruppe und Suche. Die Suche hält mindestens die Trefffläche der
 * Lupe plus die Kopf-Polsterung beidseits (`--lfh-kopf-polsterung` an der Suchzelle).
 */
export function kopfRasterSpalten(suchTrefflaeche: number): string {
  return `minmax(min-content, max-content) minmax(calc(${suchTrefflaeche}px + 2 * var(--lfh-kopf-polsterung)), 1fr)`;
}

/**
 * Markenzelle: Bildmarke „Lebenslinie“ (LFH-837) in der Textfarbe des Rahmens, in Rail-Breite.
 * Sonst reine Dekoration, den Namen trägt die Wortmarke daneben. Mit `alsLink` übernimmt sie
 * deren Ziel und Namen: im App-Rahmen unter `md`, wo die Wortmarke der Uhr weicht (LLH-1728, D5).
 */
export function Markenzelle({ alsLink = false }: { alsLink?: boolean }) {
  const { token } = theme.useToken();
  const breite = railBreite(token);
  const stil: CSSProperties = {
    width: breite,
    flex: `0 0 ${breite}px`,
    minHeight: KOPF_HOEHE,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderInlineEnd: `1px solid ${rahmenFarben.linie}`,
  };
  const marke = <Bildmarke hoehe={MARKENZELLE_BILDMARKE_HOEHE} linienFarbe={rahmenFarben.text} />;
  if (alsLink) {
    // Als Bedienziel hält die Zelle den Boden der Staffel (72 px in `handschuh`, Gate 1).
    return (
      <Link
        to={einsaetzePfad()}
        aria-label="lifeline-hub"
        data-lfh="kopf-marke"
        style={{ ...stil, minHeight: Math.max(KOPF_HOEHE, token.controlHeight) }}
      >
        {marke}
      </Link>
    );
  }
  return (
    <div aria-hidden="true" data-lfh="kopf-marke" style={stil}>
      {marke}
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
    fontSize: schriftGroesse('klein'),
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
    <Link to={einsaetzePfad()} data-schrift="kennung" style={wortmarkeStil(token)}>
      lifeline-hub
    </Link>
  );
}

/** Uhrzeit HH:MM in Browserzeit. */
export function formatiereUhr(ms: number): string {
  return dayjs(ms).format('HH:mm');
}

/**
 * Die Uhr der Kommandoleiste (Rolle `uhr`: Mono, Stufe `titel`, 500; LLH-1773). Browserzeit,
 * nicht die Anzeigezone eines Einsatzes: der Kopf liegt AUSSERHALB des `EinsatzAnzeigeProvider`
 * und steht auch auf der Einsatzliste. Eine Uhr, die je Route die Zone wechselt, wäre schlimmer.
 */
export function Uhr({
  zelle,
  trenner = 'ende',
}: {
  zelle?: { padding: number };
  trenner?: 'ende' | 'keiner';
}) {
  const { token } = theme.useToken();
  const jetzt = useMinutenTakt();
  const text = formatiereUhr(jetzt);
  // `zelle`: die Polsterung der Nachbarzellen; unter `md` die schmale des Handy-Kopfs (LLH-1728, D3).
  return (
    <div data-lfh="kopf-uhr" style={kopfZelleStil(zelle ?? token, trenner)}>
      <time
        dateTime={dayjs(jetzt).format('HH:mm')}
        aria-label={`Uhrzeit ${text}`}
        style={{
          ...schriftStil('uhr'),
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
  | 'verbunden'
  | 'verbinde'
  | 'wiederaufbau'
  | 'getrennt'
  | 'offline'
  | 'ausstehend'
  | 'abgelehnt'
  | 'ruhe';

/**
 * Leitet den Zustand ab — REIN und exportiert, damit die Rangfolge ohne Rendern prüfbar ist.
 *
 * Was Daten gefährdet, geht vor dem, was nur verzögert: `offline` vor `getrennt` (ohne Netz ist
 * der Strom zwangsläufig weg), abgelehnte Offline-Aktionen vor dem Verbindungsaufbau (sie
 * verlangen eine Handlung), ausstehende danach (sie gehen von selbst hinaus).
 *
 * `idle` ist der Zustand VOR dem ersten Verbindungsversuch — im Einsatz „verbinde", nie
 * „getrennt", sonst meldete jeder Kaltstart Alarm. `connecting` meldet `live/liveVerbindung.ts`
 * dagegen erst nach der Schonfrist eines Wiederaufbaus mitten in der Sitzung, und bei Netzfehlern
 * endlos: „wiederaufbau“ ist eine Störung mit Wort (Review LLH-1726), und vorgemerkte Aktionen
 * stehen beim Start vor dem wortlosen Aufbau.
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
  if (liveErwartet && live === 'connecting') return 'wiederaufbau';
  if (queue.ausstehend > 0) return 'ausstehend';
  if (liveErwartet && live === 'idle') return 'verbinde';
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
  wiederaufbau: {
    wort: 'VERBINDE',
    satz: () => 'Live-Verbindung wird wiederhergestellt',
    farbe: farbenDunkel.achtung,
    getrennt: false,
  },
  ausstehend: {
    // Deutsch statt „QUEUE“ (LFH-944): wer das Wort nicht kennt, hält ausstehende Einträge für
    // schon beim Server.
    wort: 'WARTET',
    satz: (q) => `${anzahl(q.ausstehend, 'Offline-Aktion', 'Offline-Aktionen')} ausstehend`,
    farbe: farbenDunkel.achtung,
    getrennt: false,
  },
  getrennt: {
    wort: 'GETRENNT',
    satz: () => 'Live-Verbindung unterbrochen',
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
    satz: (q) =>
      `${anzahl(q.abgelehnt, 'Offline-Aktion', 'Offline-Aktionen')} abgelehnt — bitte prüfen`,
    farbe: rahmenFarben.alarm,
    getrennt: false,
  },
};

/**
 * SYNC-Anzeige: WLAN-Icon (Haken verbunden, Kreuz getrennt; LFH-595) + Wort (Mono 11). Eine
 * ANZEIGE, kein Bedienziel — die Handlungen trägt die Betriebszeile (`LiveStatusBanner`) aus
 * demselben Store (LFH-336 · M3).
 *
 * `liveErwartet`: nur der Einsatz-Workspace hält einen SSE-Strom. Auf der Einsatzliste erscheint
 * die Zelle nur bei Netzverlust oder offener Queue.
 *
 * WORT GENAU BEI STÖRUNG (LLH-1726, Spec `kopfleiste`): Die stehende Verbindung und ihr Aufbau
 * beim Start stehen in jeder Breite nur als Icon, der Aufbau in `achtung`. Beide verlangen nichts, und der
 * Aufbau beim Start wechselte sonst ohne Zutun die Breite des Kopfs (vorher hielt ein Platzhalter
 * dafür dauerhaft die Breite von „VERBINDE“, LLH-1158). Jede Störung (VERBINDE beim Wiederaufbau,
 * WARTET, GETRENNT, OFFLINE, PRÜFEN) trägt ihr Wort — Farbe allein wäre ein Kanal (WCAG 1.4.1). Den Zustand nennen in jedem
 * Fall `aria-label` und `title`. WARTET und PRÜFEN stehen beim Neuladen schon im ersten Bild: der
 * Zähler beginnt mit dem zuletzt gelesenen Stand der Person (LLH-1910,
 * `offline/queueZaehlerMerker.ts`); nicht beim ersten Laden nach einer Anmeldung und nicht ohne
 * Browserspeicher.
 *
 * `kompakt` (unter `md`): nur Icon, auch bei Störung; das Wort steht in der Betriebszeile.
 * `zelle`: die Polsterung der Nachbarzellen, ohne das Wort zu nehmen (Gerätekopf unter `md`, der
 * keine Betriebszeile hat und das Wort selbst tragen muss).
 */
export function syncZeigtWort(zustand: Exclude<SyncZustand, 'ruhe'>, kompakt: boolean): boolean {
  if (kompakt) return false;
  return zustand !== 'verbunden' && zustand !== 'verbinde';
}

export function SyncAnzeige({
  liveErwartet,
  kompakt = false,
  zelle,
}: {
  liveErwartet: boolean;
  kompakt?: boolean;
  zelle?: { padding: number };
}) {
  const { token } = theme.useToken();
  const { benutzer } = useAuth();
  const live = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);
  const online = useOnline();
  const queue = useOfflineQueueZaehler(benutzer?.id);
  const zustand = syncZustand({ online, live, liveErwartet, queue });
  if (zustand === 'ruhe') return null;
  const d = SYNC_DARSTELLUNG[zustand];
  const Icon = d.getrennt ? IconWlanGetrennt : IconWlanVerbunden;
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
      style={kopfZelleStil(zelle ?? (kompakt ? { padding: token.paddingXS } : token))}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', color: d.farbe }}>
        <Icon size={16} />
      </span>
      {syncZeigtWort(zustand, kompakt) && (
        // Nur Störungen tragen ein Wort, also färbt es mit: dann soll es auffallen. Ein
        // Zustandswort, keine Zahl: Textschrift (LLH-1777, Mono-Grenze).
        <span
          aria-hidden="true"
          style={{ ...schriftStil('meta'), fontSize: schriftGroesse('fein'), color: d.farbe }}
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
