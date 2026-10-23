import { Typography } from 'antd';
import dayjs from 'dayjs';
import { schrift, schriftskala } from '../theme/tokens';
import { useOhneVerbindung } from '../offline/verbindung';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../anzeige/format';
import { leereUhrzeit, zeitKurz, zeitpunkt } from '../anzeige/zeitDarstellung';

interface DatenstandProps {
  /** TanStack-Query-Zeitstempel (`query.dataUpdatedAt`) in Millisekunden. */
  dataUpdatedAt?: number;
  /**
   * Vor dem ersten Abruf die Breite freihalten statt nichts zu zeigen (LFH-373): sonst erschiene
   * „Stand hh:mm" erst mit den Daten, bräche auf 390 px um und schöbe alles darunter nach unten
   * (`e2e/leisten-flaeche.spec.ts`, „Laden ohne Sprung"). Die Uhrzeit in Mono mit
   * Tabellenziffern — ein Platzhalter mit gleich vielen Ziffern der Darstellung ist gleich breit. Wirksam nur unter `md`: ab dort blendet
   * `EinsatzSeite.css` ihn aus, weil die spät eintreffende Meta ihn seitwärts schöbe.
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
 * Kompakte, wiederverwendbare Datenfrische-Anzeige für Seiten- und Sektionsköpfe, als Mono-Meta
 * (`schriftskala.meta`, 11 px): eine Uhrzeit ist eine Zahl.
 */
const STIL = {
  fontFamily: schrift[schriftskala.meta.familie],
  fontSize: schriftskala.meta.groesse,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
} as const;

export default function Datenstand({
  dataUpdatedAt,
  platzHalten = false,
  offline: offlineVorgabe,
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
  const uhrzeit = formatiereDatenstand(dataUpdatedAt, konventionen);
  return (
    <Typography.Text
      type="secondary"
      title={`Letzte Aktualisierung: ${zeitpunkt(dayjs(dataUpdatedAt), geraetezeit(konventionen))}`}
      aria-label={offline ? `Datenstand ${uhrzeit}, offline` : `Datenstand ${uhrzeit}`}
      style={STIL}
    >
      {offline ? `Stand ${uhrzeit} · offline` : `Stand ${uhrzeit}`}
    </Typography.Text>
  );
}
