import { Alert, Button } from 'antd';

interface HistorienBannerProps {
  /** Zeitstempel des angezeigten Standes (`stand_at`, ISO). */
  standAt?: string;
  /** Bezeichnung des Standes, falls gesetzt. */
  bezeichnung?: string | null;
  /** Zurück in den Live-Modus (räumt `?snapshot=`). */
  onZurueckAktuell: () => void;
}

function formatiereStand(standAt?: string): string {
  if (!standAt) return '';
  const d = new Date(standAt);
  return Number.isNaN(d.getTime()) ? standAt : d.toLocaleString('de-DE');
}

/**
 * Historien-Modus-Banner (C/LFH-321): schwebt über der Karte, sobald ein Snapshot aktiv ist,
 * und macht die Schreibsperre sichtbar. Der „Aktuell"-Button springt in den Live-Modus zurück.
 */
export function HistorienBanner({ standAt, bezeichnung, onZurueckAktuell }: HistorienBannerProps) {
  const stand = formatiereStand(standAt);
  const beschreibung = [bezeichnung?.trim(), stand].filter(Boolean).join(' · ');
  return (
    <Alert
      type="warning"
      showIcon
      message="Historischer Stand — schreibgeschützt"
      description={beschreibung || undefined}
      action={
        <Button size="small" onClick={onZurueckAktuell}>
          Aktuell
        </Button>
      }
      style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 5 }}
    />
  );
}
