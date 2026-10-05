import { IconTelefon } from '../icons';
import { Space, Tag, Typography } from 'antd';
import type { Sprechgruppe } from '../api/types';
import { kommunikationsmittelLabel, teileSprechgruppen } from './kommunikationsmittel';

// Die Optionen leben im reinen Kern; der Re-Export hält die bestehenden Importe stabil.
export { KOMMUNIKATIONSMITTEL_OPTIONEN } from './kommunikationsmittel';

interface FunkErreichbarkeitProps {
  sprechgruppen?: Sprechgruppe[] | null;
  kommunikationsmittel?: string | null;
  erreichbarkeit?: string | null;
  /** Fallback, wenn gar keine Funk-Daten vorliegen. Ohne diesen Text wird nichts gerendert. */
  leerText?: string;
}

/**
 * Kompakte Lese-Darstellung der Funk-/Kommunikationsdaten als Tag-Zeile
 * (TMO/DMO-Sprechgruppen · Kommunikationsmittel · Telefon-Erreichbarkeit). Geteilt von
 * Einsatzabschnitt (LFH-86/107) und Einheit (LFH-108), damit die Anzeige an einer Stelle lebt.
 * Alle Marken neutral (LFH-891): das Präfix „TMO:“/„DMO:“ unterscheidet, Blau bedient.
 */
export default function FunkErreichbarkeit({
  sprechgruppen,
  kommunikationsmittel,
  erreichbarkeit,
  leerText,
}: FunkErreichbarkeitProps) {
  const { tmo, dmo } = teileSprechgruppen(sprechgruppen);
  const hatDaten = tmo.length > 0 || dmo.length > 0 || !!kommunikationsmittel || !!erreichbarkeit;

  if (!hatDaten) {
    return leerText ? <Typography.Text type="secondary">{leerText}</Typography.Text> : null;
  }

  return (
    <div data-testid="funk-erreichbarkeit">
      <Space size={[4, 4]} wrap>
        {tmo.map((s) => (
          <Tag key={s.id}>TMO: {s.bezeichnung}</Tag>
        ))}
        {dmo.map((s) => (
          <Tag key={s.id}>DMO: {s.bezeichnung}</Tag>
        ))}
        {kommunikationsmittel && <Tag>{kommunikationsmittelLabel(kommunikationsmittel)}</Tag>}
        {erreichbarkeit && <Tag icon={<IconTelefon />}>{erreichbarkeit}</Tag>}
      </Space>
    </div>
  );
}
