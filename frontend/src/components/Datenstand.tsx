import { Typography } from 'antd';
import dayjs from 'dayjs';

interface DatenstandProps {
  /** TanStack-Query-Zeitstempel (`query.dataUpdatedAt`) in Millisekunden. */
  dataUpdatedAt?: number;
}

/** Formatiert einen Query-Zeitstempel in der lokalen Browserzeit. */
export function formatiereDatenstand(dataUpdatedAt: number): string {
  return dayjs(dataUpdatedAt).format('HH:mm');
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

/** Kompakte, wiederverwendbare Datenfrische-Anzeige für Seiten- und Sektionsköpfe. */
export default function Datenstand({ dataUpdatedAt }: DatenstandProps) {
  if (!dataUpdatedAt || !Number.isFinite(dataUpdatedAt)) return null;
  const uhrzeit = formatiereDatenstand(dataUpdatedAt);
  return (
    <Typography.Text
      type="secondary"
      title={`Letzte Aktualisierung: ${dayjs(dataUpdatedAt).format('DD.MM.YYYY HH:mm:ss')}`}
      aria-label={`Datenstand ${uhrzeit}`}
    >
      Stand {uhrzeit}
    </Typography.Text>
  );
}
