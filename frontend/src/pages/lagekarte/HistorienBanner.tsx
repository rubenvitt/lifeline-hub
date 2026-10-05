import { Alert, Button } from 'antd';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';

interface HistorienBannerProps {
  /** Zeitstempel des angezeigten Standes (`stand_at`, naiver UTC-Wire-String). */
  standAt?: string;
  /** Bezeichnung des Standes, falls gesetzt. */
  bezeichnung?: string | null;
  /** Zurück in den Live-Modus (räumt `?snapshot=`). */
  onZurueckAktuell: () => void;
}

/**
 * Historien-Banner: steht über der Karte, sobald ein Snapshot aktiv ist, und macht die
 * Schreibsperre sichtbar. „Aktuell" springt in den Live-Modus zurück. Im Fluss über der
 * Kartenfläche statt absolut auf ihr — oben liegen Kartengrundlage, Zeigerkoordinate und
 * Knopfblock.
 */
export function HistorienBanner({ standAt, bezeichnung, onZurueckAktuell }: HistorienBannerProps) {
  // `formatZeit` (dayjs.utc) statt `new Date()`: `stand_at` ist ein naiver UTC-Wire-String, den
  // `new Date()` als Lokalzeit läse. Gebunden an die Anzeigezone (LFH-913).
  const { formatZeit } = useAnzeigeKonventionen();
  const stand = standAt ? formatZeit(standAt) : '';
  const beschreibung = [bezeichnung?.trim(), stand].filter(Boolean).join(' · ');
  return (
    <Alert
      type="warning"
      showIcon
      message="Historischer Stand — schreibgeschützt"
      description={beschreibung || undefined}
      action={
        /* Ohne Größen-Prop: die Trefffläche kommt aus `controlHeight`. */
        <Button onClick={onZurueckAktuell}>Aktuell</Button>
      }
    />
  );
}
