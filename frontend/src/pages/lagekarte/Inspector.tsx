import { Button, Descriptions, Select, Space, Tag } from 'antd';
import { Link } from 'react-router-dom';
import type { KarteMarker, MarkerTyp } from './marker';
import { markerToUrl } from './markerToUrl';
import KartenDetailCard from './KartenDetailCard';
import KoordinatenAnzeige from '../../anzeige/KoordinatenAnzeige';

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
  lagemeldung: 'Lagemeldung',
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

/** Mappt Marker-Typ auf Backend-Tag für exclude-Parameter der Ort-Vorschau.
 *  `fuehrung` → `personal` (Führungskraft liegt in der personal-Tabelle).
 *  `abschnitt` → kein eindeutiges Backend-Tag → undefined (exclude weggelassen). */
function inspectorExclude(m: KarteMarker, einsatzId: number): string | undefined {
  switch (m.typ) {
    case 'einsatzort': return `einsatzort:${einsatzId}`;
    case 'uhs':        return `uhs:${m.id}`;
    case 'schaden':    return `schaden:${m.id}`;
    case 'einheit':    return `einheit:${m.id}`;
    case 'fahrzeug':   return `fahrzeug:${m.id}`;
    case 'fuehrung':   return `personal:${m.id}`;
    case 'lagemeldung': return `lagemeldung:${m.id}`;
    case 'abschnitt':  return undefined;
  }
}

/** Kompakter Marker-Inspector mit Link ins jeweilige Fach-Modul. */
export default function Inspector({
  einsatzId, marker, darfSchreiben, onSchliessen, onVerortungLoeschen, onSymbolAendern,
}: InspectorProps) {
  const modulLink = markerToUrl(marker, einsatzId);

  const symbolAuswahl = darfSchreiben && onSymbolAendern && TAKTISCHE_TYPEN.includes(marker.typ);

  return (
    <KartenDetailCard titel={marker.label} akzentFarbe={marker.farbe} onSchliessen={onSchliessen}>
      <Tag color={marker.farbe} style={{ marginBottom: 8 }}>{TYP_LABEL[marker.typ]}</Tag>
      <Descriptions column={1} size="small">
        {marker.typ === 'lagemeldung' && marker.lageMeldung && (
          <Descriptions.Item label="Absender">{marker.lageMeldung.absender}</Descriptions.Item>
        )}
        {marker.typ === 'lagemeldung' && marker.lageMeldung && (
          <Descriptions.Item label="Inhalt">{marker.lageMeldung.inhalt}</Descriptions.Item>
        )}
        <Descriptions.Item label="Koordinate">
          <KoordinatenAnzeige lat={marker.lat} lon={marker.lon} einsatzId={einsatzId} exclude={inspectorExclude(marker, einsatzId)} />
        </Descriptions.Item>
      </Descriptions>
      {symbolAuswahl && (
        <Space orientation="vertical" size="small" style={{ width: '100%', marginTop: 8 }}>
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
          <Button size="small">
            {marker.typ === 'lagemeldung' ? 'Zur Quell-Meldung' : 'Im Fach-Modul öffnen'}
          </Button>
        </Link>
        {/* Lagemeldungen sind auf der Karte read-only: verortet wird ausschließlich beim
            Übergeben (LFH-113). Re-/Ent-Verorten würde am ON-CONFLICT-Upsert ohnehin verpuffen. */}
        {darfSchreiben && marker.typ !== 'einsatzort' && marker.typ !== 'lagemeldung' && (
          <Button size="small" danger onClick={() => onVerortungLoeschen(marker)}>
            Verortung löschen
          </Button>
        )}
      </Space>
    </KartenDetailCard>
  );
}
