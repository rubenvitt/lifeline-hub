import { Descriptions } from 'antd';
import { useRollen } from '../../components/instrument';
import { fremdebeneFarbe } from '../../theme/statusFarben';
import type { Fremdebene } from '../../api/fremdebenen';
import { alsText, pick } from './fachebeneTitel';
import KartenDetailCard from './KartenDetailCard';
import { FREMDE_DATEN } from './lageplan';

/**
 * Ein Objekt einer Fremdebene (LLH-2099, Entwurf „Zeichnen“): nur zum Lesen, mit Name,
 * Beschreibung, Ebene und dem Kennwort „Fremde Daten“ — die Angaben stammen nicht aus dem Einsatz
 * und sind nicht geprüft. Der Server liefert nur `name` und `description` als Text.
 */
export default function FremdebeneDetail({
  ebene,
  properties,
  onSchliessen,
}: {
  ebene: Fremdebene;
  properties: Record<string, unknown>;
  onSchliessen: () => void;
}) {
  const { token } = useRollen();
  const name = pick(properties, 'name');
  const beschreibung = alsText(properties.description);
  return (
    <KartenDetailCard
      titel={name ?? ebene.name}
      akzentFarbe={fremdebeneFarbe(ebene.color, token)}
      kachel="FD"
      unterzeile={FREMDE_DATEN}
      onSchliessen={onSchliessen}
    >
      <Descriptions
        size="small"
        column={1}
        items={[
          ...(beschreibung
            ? [{ key: 'beschreibung', label: 'Beschreibung', children: beschreibung }]
            : []),
          { key: 'ebene', label: 'Ebene', children: ebene.name },
          {
            key: 'herkunft',
            label: 'Herkunft',
            children:
              ebene.source === 'url' && ebene.url_host
                ? `${FREMDE_DATEN} von ${ebene.url_host}`
                : `${FREMDE_DATEN} aus einer Datei`,
          },
        ]}
      />
    </KartenDetailCard>
  );
}
