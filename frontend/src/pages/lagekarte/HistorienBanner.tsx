import { Alert, Button } from 'antd';
import { formatZeit } from '../../anzeige/format';

interface HistorienBannerProps {
  /** Zeitstempel des angezeigten Standes (`stand_at`, naiver UTC-Wire-String). */
  standAt?: string;
  /** Bezeichnung des Standes, falls gesetzt. */
  bezeichnung?: string | null;
  /** Zurück in den Live-Modus (räumt `?snapshot=`). */
  onZurueckAktuell: () => void;
}

/**
 * Historien-Modus-Banner (C/LFH-321): schwebt über der Karte, sobald ein Snapshot aktiv ist,
 * und macht die Schreibsperre sichtbar. Der „Aktuell"-Button springt in den Live-Modus zurück.
 */
export function HistorienBanner({ standAt, bezeichnung, onZurueckAktuell }: HistorienBannerProps) {
  // formatZeit (dayjs.utc) statt new Date(): stand_at ist ein naiver UTC-Wire-String
  // ('YYYY-MM-DD HH:MM:SS'), den new Date() als Lokalzeit fehlinterpretieren würde (LFH-321-Review).
  const stand = standAt ? formatZeit(standAt) : '';
  const beschreibung = [bezeichnung?.trim(), stand].filter(Boolean).join(' · ');
  return (
    <Alert
      type="warning"
      showIcon
      message="Historischer Stand — schreibgeschützt"
      description={beschreibung || undefined}
      action={
        /* Ohne Größen-Prop: der Rückweg aus dem schreibgeschützten Stand ist die einzige
           Bedienung des Banners und erbt seine Trefffläche aus `controlHeight` (LFH-366). */
        <Button onClick={onZurueckAktuell}>Aktuell</Button>
      }
      style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 5 }}
    />
  );
}
