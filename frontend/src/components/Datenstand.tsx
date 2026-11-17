import { Typography } from 'antd';
import dayjs from 'dayjs';
import { schrift, schriftskala } from '../theme/tokens';
import { useOhneVerbindung } from '../offline/verbindung';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../anzeige/format';
import { leereUhrzeit, zeitKurz, zeitpunkt } from '../anzeige/zeitDarstellung';
import { schriftGroesse } from './instrument/rollenwerte';
import { minutenZwischen, relativ } from '../anzeige/dauer';
import { useMinutenTakt } from './useMinutenTakt';

interface DatenstandProps {
  /** TanStack-Query-Zeitstempel (`query.dataUpdatedAt`) in Millisekunden. */
  dataUpdatedAt?: number;
  /**
   * Vor dem ersten Abruf die Breite freihalten statt nichts zu zeigen (LFH-373): sonst erschiene
   * „Stand hh:mm" erst mit den Daten, bräche auf 390 px um und schöbe alles darunter nach unten
   * (`e2e/leisten-flaeche.spec.ts`, „Laden ohne Sprung"). Die Uhrzeit in Mono mit
   * Tabellenziffern — ein Platzhalter mit gleich vielen Ziffern der Darstellung ist gleich breit. Im
   * Seitenkopf gilt er in jeder Breite (LLH-1463, `EinsatzSeite.css`).
   */
  platzHalten?: boolean;
  /**
   * Ohne Verbindung (LFH-723): der Stand ist vorgehalten und kommt nicht nach. Dann lautet die
   * Anzeige „Stand 1432 · offline" — die Uhrzeit bleibt die der letzten Server-Antwort
   * (`hydrate` übernimmt `dataUpdatedAt`), nicht die des Neuladens.
   *
   * Vorgabe ist der Verbindungszustand (`useOhneVerbindung`: Browser offline ODER Server nicht
   * erreichbar, `offline/verbindung.ts`), abgefragt HIER und nicht bei den Aufrufern:
   * der Datenstand steht im Seitenkopf, in Abschnittsköpfen (`Bereichskopf`, `SektionHeader`)
   * und in Paneelen, und eine Kennzeichnung, die jede Stelle einzeln durchreichen muss, fehlt
   * an der ersten vergessenen (gemessen: die Aufträge führen ihren Stand im Abschnittskopf).
   * Die Prop übersteuert nur.
   */
  offline?: boolean;
  /**
   * Das Alter dazu, ab einer Minute („Stand 1731 · vor 2 min“, LLH-1750, Spec `zeitdarstellung`,
   * „Eine Form für den Datenstand“): nur auf Lagebild, Großbild und Lagemonitor, wo man auf die
   * Frische achtet. Tickt im Minutentakt; ohne `alter` tickt nichts.
   */
  alter?: boolean;
}

/**
 * Formatiert einen Query-Zeitstempel in der Rolle „kurz“ der wirksamen Darstellung (LLH-1061:
 * heute `1432`, sonst `221432`), aber bewusst in der GERÄTEZEIT (Spec `zeiteingabe`, Ausnahme
 * Datenstand im Kopf): der Stand misst den Browser, nicht den Einsatz.
 */
export function formatiereDatenstand(
  dataUpdatedAt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return zeitKurz(dayjs(dataUpdatedAt), geraetezeit(konv));
}

/** Die Konventionen mit der Browserzone: Darstellung folgt der Wahl, die Zone dem Gerät. */
function geraetezeit(konv: AnzeigeKonventionen): AnzeigeKonventionen {
  return { ...konv, zeitzone: null };
}

/**
 * Der Datenstand als Text, eine Form für alle Stellen (LLH-1750, Spec `zeitdarstellung`, „Eine
 * Form für den Datenstand“): „Stand 1731“, mit `alter` ab einer Minute „Stand 1731 · vor 2 min“,
 * ohne Netz „… · offline“ am Ende. Kein „vor 0 s“ und nie ein Stand nur als Alter. `0` oder
 * ungültig heißt „noch nichts abgerufen“. Rein; für Stellen, die einen Text brauchen (Großbild,
 * Lagemonitor), sonst der Baustein {@link Datenstand}.
 */
export function datenstandText(
  dataUpdatedAt: number,
  jetzt: number,
  opts: { alter?: boolean; offline?: boolean; konv?: AnzeigeKonventionen } = {},
): string {
  if (!Number.isFinite(dataUpdatedAt) || dataUpdatedAt <= 0) return 'Stand wird abgerufen';
  const teile = [`Stand ${formatiereDatenstand(dataUpdatedAt, opts.konv)}`];
  const alter = opts.alter ? alterText(dataUpdatedAt, jetzt) : null;
  if (alter) teile.push(alter);
  if (opts.offline) teile.push('offline');
  return teile.join(' · ');
}

/**
 * „vor 2 min“ ab einer Minute Alter, darunter nichts. Gezählt in ganzen Minuten der Uhr: „Stand
 * 1731“ heißt um 1733 „vor 2 min“, auch wenn der Abruf um 17:31:45 kam (Spec `zeitdarstellung`).
 */
function alterText(dataUpdatedAt: number, jetzt: number): string | null {
  const minuten = minutenZwischen(volleMinute(dataUpdatedAt), volleMinute(jetzt));
  return minuten >= 1 ? relativ(minuten, 'vor') : null;
}

function volleMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}

/**
 * Für zusammengesetzte Ansichten gilt der älteste geladene Teil als Stand der
 * Gesamtansicht. Ein neuer Teilabruf darf die übrigen, älteren Daten nicht jünger ausweisen.
 */
export function gemeinsamerDatenstand(...zeitstempel: Array<number | undefined>): number {
  const geladen = zeitstempel.filter(
    (wert): wert is number => typeof wert === 'number' && Number.isFinite(wert) && wert > 0,
  );
  return geladen.length > 0 ? Math.min(...geladen) : 0;
}

/**
 * Kompakte, wiederverwendbare Datenfrische-Anzeige für Seiten- und Sektionsköpfe, als Meta
 * (`schriftskala.meta`, Stufe `klein`): „Stand 14:32“ trägt ein Wort, steht also in der Textschrift
 * mit gleich breiten Ziffern (LLH-1777, Mono-Grenze).
 */
const STIL = {
  fontFamily: schrift[schriftskala.meta.familie],
  fontSize: schriftGroesse('klein'),
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
} as const;

export default function Datenstand({
  dataUpdatedAt,
  platzHalten = false,
  offline: offlineVorgabe,
  alter = false,
}: DatenstandProps) {
  const ohneVerbindung = useOhneVerbindung();
  const { konventionen } = useAnzeigeKonventionen();
  const offline = offlineVorgabe ?? ohneVerbindung;
  if (!dataUpdatedAt || !Number.isFinite(dataUpdatedAt)) {
    if (!platzHalten) return null;
    // Unsichtbar UND stumm: ein Vorleser soll keinen Stand „0000" hören. Ziffernbreite der
    // Darstellung, sonst wäre der Platzhalter breiter oder schmaler als der Stand danach.
    return (
      <Typography.Text
        data-lfh="datenstand-platzhalter"
        aria-hidden="true"
        style={{ ...STIL, visibility: 'hidden' }}
      >
        {`Stand ${leereUhrzeit(konventionen).replace(/—/g, '0')}`}
      </Typography.Text>
    );
  }
  return alter ? (
    <StandMitAlter dataUpdatedAt={dataUpdatedAt} offline={offline} konventionen={konventionen} />
  ) : (
    <StandText dataUpdatedAt={dataUpdatedAt} offline={offline} konventionen={konventionen} />
  );
}

/** Eigener Baustein, damit nur ein Stand mit Alter im Minutentakt rendert. */
function StandMitAlter(props: {
  dataUpdatedAt: number;
  offline: boolean;
  konventionen: AnzeigeKonventionen;
}) {
  const jetzt = useMinutenTakt();
  return <StandText {...props} alter={alterText(props.dataUpdatedAt, jetzt)} />;
}

function StandText({
  dataUpdatedAt,
  offline,
  konventionen,
  alter = null,
}: {
  dataUpdatedAt: number;
  offline: boolean;
  konventionen: AnzeigeKonventionen;
  alter?: string | null;
}) {
  const uhrzeit = formatiereDatenstand(dataUpdatedAt, konventionen);
  const name = [`Datenstand ${uhrzeit}`, alter, offline ? 'offline' : null].filter(Boolean);
  const text = [`Stand ${uhrzeit}`, alter, offline ? 'offline' : null].filter(Boolean);
  return (
    <Typography.Text
      type="secondary"
      title={`Letzte Aktualisierung: ${zeitpunkt(dayjs(dataUpdatedAt), geraetezeit(konventionen))}`}
      // Millisekundengenauer Anker für e2e: der Titel trägt seit LLH-1061 nur noch Minuten.
      data-stand={dataUpdatedAt}
      aria-label={name.join(', ')}
      style={STIL}
    >
      {text.join(' · ')}
    </Typography.Text>
  );
}
