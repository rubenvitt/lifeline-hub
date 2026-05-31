import { Button, Card, Descriptions, Select, Space } from 'antd';
import { Link } from 'react-router-dom';
import type { KarteMarker, MarkerTyp } from './marker';

export interface InspectorProps {
  einsatzId: number;
  marker: KarteMarker;
  darfSchreiben: boolean;
  onSchliessen: () => void;
  onVerortungLoeschen: (marker: KarteMarker) => void;
  onSymbolAendern?: (
    marker: KarteMarker,
    patch: { tz_fachaufgabe?: string | null; tz_organisation?: string | null },
  ) => void;
}

const TYP_LABEL: Record<MarkerTyp, string> = {
  uhs: 'Unfallhilfsstelle',
  schaden: 'Schaden',
  einheit: 'Einheit',
  fahrzeug: 'Fahrzeug',
  fuehrung: 'Führungskraft',
  abschnitt: 'Einsatzabschnitt',
  einsatzort: 'Einsatzort',
};

const FACHAUFGABE_OPTIONEN = [
  { value: 'rettungswesen', label: 'Rettungswesen/Sanität' },
  { value: 'aerztliche-versorgung', label: 'Ärztliche Versorgung' },
  { value: 'betreuung', label: 'Betreuung' },
  { value: 'verpflegung', label: 'Verpflegung' },
  { value: 'fuehrung', label: 'Führung' },
  { value: 'bergung', label: 'Bergung' },
  { value: 'wasserrettung', label: 'Wasserrettung' },
];

const ORG_OPTIONEN = [
  { value: 'feuerwehr', label: 'Feuerwehr' },
  { value: 'thw', label: 'THW' },
  { value: 'hilfsorganisation', label: 'Hilfsorganisation' },
  { value: 'polizei', label: 'Polizei' },
  { value: 'bundeswehr', label: 'Bundeswehr' },
  { value: 'zivil', label: 'Zivil' },
];

const TAKTISCHE_TYPEN: MarkerTyp[] = ['einheit', 'fahrzeug', 'fuehrung', 'abschnitt'];

/** Kompakter Marker-Inspector mit Link ins jeweilige Fach-Modul. */
export default function Inspector({
  einsatzId, marker, darfSchreiben, onSchliessen, onVerortungLoeschen, onSymbolAendern,
}: InspectorProps) {
  const modulLink =
    marker.typ === 'uhs' ? `/einsaetze/${einsatzId}/unfallhilfsstellen/${marker.id}`
    : marker.typ === 'schaden' ? `/einsaetze/${einsatzId}/schaeden?schaden=${marker.id}`
    : marker.typ === 'einheit' ? `/einsaetze/${einsatzId}/einheiten`
    : marker.typ === 'fahrzeug' ? `/einsaetze/${einsatzId}/fahrzeuge`
    : marker.typ === 'fuehrung' ? `/einsaetze/${einsatzId}/personal`
    : marker.typ === 'abschnitt' ? `/einsaetze/${einsatzId}/einsatzabschnitte`
    : `/einsaetze/${einsatzId}/einsatzdaten`;

  const symbolAuswahl = darfSchreiben && onSymbolAendern && TAKTISCHE_TYPEN.includes(marker.typ);

  return (
    <Card
      size="small"
      title={marker.label}
      extra={<Button size="small" type="text" onClick={onSchliessen} aria-label="Schließen">×</Button>}
      style={{ position: 'absolute', right: 12, top: 12, width: 280, zIndex: 5 }}
    >
      <Descriptions column={1} size="small">
        <Descriptions.Item label="Typ">{TYP_LABEL[marker.typ]}</Descriptions.Item>
        <Descriptions.Item label="Koordinate">
          {marker.lat.toFixed(5)}, {marker.lon.toFixed(5)}
        </Descriptions.Item>
      </Descriptions>
      {symbolAuswahl && (
        <Space direction="vertical" size="small" style={{ width: '100%', marginTop: 8 }}>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Fachaufgabe</div>
            <Select
              aria-label="Fachaufgabe"
              allowClear
              style={{ width: '100%' }}
              value={marker.tz?.fachaufgabe ?? undefined}
              options={FACHAUFGABE_OPTIONEN}
              onChange={(v) => onSymbolAendern!(marker, { tz_fachaufgabe: v ?? null })}
            />
          </label>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Organisation (Override)</div>
            <Select
              aria-label="Organisation (Override)"
              allowClear
              style={{ width: '100%' }}
              value={marker.tz?.organisation ?? undefined}
              options={ORG_OPTIONEN}
              onChange={(v) => onSymbolAendern!(marker, { tz_organisation: v ?? null })}
            />
          </label>
        </Space>
      )}
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
