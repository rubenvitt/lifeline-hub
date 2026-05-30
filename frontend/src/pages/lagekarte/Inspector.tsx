import { Button, Card, Descriptions, Space } from 'antd';
import { Link } from 'react-router-dom';
import type { KarteMarker } from './marker';

export interface InspectorProps {
  einsatzId: number;
  marker: KarteMarker;
  darfSchreiben: boolean;
  onSchliessen: () => void;
  onVerortungLoeschen: (marker: KarteMarker) => void;
}

/** Kompakter Marker-Inspector mit Link ins jeweilige Fach-Modul. */
export default function Inspector({
  einsatzId, marker, darfSchreiben, onSchliessen, onVerortungLoeschen,
}: InspectorProps) {
  const modulLink =
    marker.typ === 'uhs'
      ? `/einsaetze/${einsatzId}/unfallhilfsstellen/${marker.id}`
      : marker.typ === 'schaden'
        ? `/einsaetze/${einsatzId}/schaeden?schaden=${marker.id}`
        : `/einsaetze/${einsatzId}/einsatzdaten`;

  return (
    <Card
      size="small"
      title={marker.label}
      extra={<Button size="small" type="text" onClick={onSchliessen} aria-label="Schließen">×</Button>}
      style={{ position: 'absolute', right: 12, top: 12, width: 280, zIndex: 5 }}
    >
      <Descriptions column={1} size="small">
        <Descriptions.Item label="Typ">
          {marker.typ === 'uhs' ? 'Unfallhilfsstelle' : marker.typ === 'schaden' ? 'Schaden' : 'Einsatzort'}
        </Descriptions.Item>
        <Descriptions.Item label="Koordinate">
          {marker.lat.toFixed(5)}, {marker.lon.toFixed(5)}
        </Descriptions.Item>
      </Descriptions>
      <Space style={{ marginTop: 8 }}>
        <Link to={modulLink}>
          <Button size="small">Im Fach-Modul öffnen</Button>
        </Link>
        {darfSchreiben && marker.typ !== 'einsatzort' && (
          <Button size="small" danger onClick={() => onVerortungLoeschen(marker)}>
            Verortung löschen
          </Button>
        )}
      </Space>
    </Card>
  );
}
