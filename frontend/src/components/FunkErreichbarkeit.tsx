import { Space, Tag, Typography } from 'antd';
import type { Sprechgruppe } from '../api/types';

/** Freitext-Schlüssel → Anzeige-Label für das Kommunikationsmittel (Abschnitt LFH-86, Einheit LFH-108). */
export const KOMMUNIKATIONSMITTEL_LABEL: Record<string, string> = {
  digitalfunk: 'Digitalfunk',
  mobil: 'Mobil',
  festnetz: 'Festnetz',
};

export const KOMMUNIKATIONSMITTEL_OPTIONEN = Object.entries(KOMMUNIKATIONSMITTEL_LABEL).map(
  ([value, label]) => ({ value, label }),
);

interface FunkErreichbarkeitProps {
  sprechgruppen?: Sprechgruppe[] | null;
  kommunikationsmittel?: string | null;
  erreichbarkeit?: string | null;
  /** Fallback, wenn gar keine Funk-Daten vorliegen. Ohne diesen Text wird nichts gerendert. */
  leerText?: string;
}

/**
 * Kompakte Lese-Darstellung der Funk-/Kommunikationsdaten als Tag-Zeile
 * (TMO/DMO-Sprechgruppen · Kommunikationsmittel · ☎ Erreichbarkeit). Geteilt von
 * Einsatzabschnitt (LFH-86/107) und Einheit (LFH-108), damit die Anzeige an einer Stelle lebt.
 */
export default function FunkErreichbarkeit({
  sprechgruppen,
  kommunikationsmittel,
  erreichbarkeit,
  leerText,
}: FunkErreichbarkeitProps) {
  const tmo = (sprechgruppen ?? []).filter((s) => s.betriebsart === 'TMO');
  const dmo = (sprechgruppen ?? []).filter((s) => s.betriebsart === 'DMO');
  const hatDaten = tmo.length > 0 || dmo.length > 0 || !!kommunikationsmittel || !!erreichbarkeit;

  if (!hatDaten) {
    return leerText ? <Typography.Text type="secondary">{leerText}</Typography.Text> : null;
  }

  return (
    <div data-testid="funk-erreichbarkeit">
      <Space size={[4, 4]} wrap>
        {tmo.map((s) => (
          <Tag key={s.id} color="blue">
            TMO: {s.bezeichnung}
          </Tag>
        ))}
        {dmo.map((s) => (
          <Tag key={s.id} color="geekblue">
            DMO: {s.bezeichnung}
          </Tag>
        ))}
        {kommunikationsmittel && (
          <Tag>{KOMMUNIKATIONSMITTEL_LABEL[kommunikationsmittel] ?? kommunikationsmittel}</Tag>
        )}
        {erreichbarkeit && <Tag>☎ {erreichbarkeit}</Tag>}
      </Space>
    </div>
  );
}
