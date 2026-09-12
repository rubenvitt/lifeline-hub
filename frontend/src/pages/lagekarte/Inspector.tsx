import { Button, Descriptions, Space, Tag, theme } from 'antd';
import { useId } from 'react';
import { Select } from '../../components/Select';
import FeldLabel from '../../components/FeldLabel';
import GeoKennzahlen from '../../components/GeoKennzahlen';
import { Link } from 'react-router';
import type { KarteMarker, MarkerTyp } from './marker';
import { markerToUrl } from './markerToUrl';
import { geoKennzahlen } from './geo';
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
  fuehrung: 'Personal',
  abschnitt: 'Einsatzabschnitt',
  einsatzort: 'Einsatzort',
  lagemeldung: 'Lagemeldung',
  freies_zeichen: 'Taktisches Zeichen',
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
    case 'einsatzort':
      return `einsatzort:${einsatzId}`;
    case 'uhs':
      return `uhs:${m.id}`;
    case 'schaden':
      return `schaden:${m.id}`;
    case 'einheit':
      return `einheit:${m.id}`;
    case 'fahrzeug':
      return `fahrzeug:${m.id}`;
    case 'fuehrung':
      return `personal:${m.id}`;
    case 'lagemeldung':
      return `lagemeldung:${m.id}`;
    // Freie Zeichen haben kein Fachobjekt-Backend-Tag → keine Ort-Vorschau-Exklusion.
    case 'freies_zeichen':
      return undefined;
    case 'abschnitt':
      return undefined;
  }
}

/** Kompakter Marker-Inspector mit Link ins jeweilige Fach-Modul. */
export default function Inspector({
  einsatzId,
  marker,
  darfSchreiben,
  onSchliessen,
  onVerortungLoeschen,
  onSymbolAendern,
}: InspectorProps) {
  const { token } = theme.useToken();
  // Eigene ids statt fester Literale: der Inspector kann neben anderen Feldern derselben
  // Beschriftung stehen, doppelte ids brächen die Label-Assoziation.
  const fachaufgabeId = useId();
  const organisationId = useId();
  const modulLink = markerToUrl(marker, einsatzId);
  // Geometrie-Kennzahlen (z. B. Abschnittsfläche), rein clientseitig (LFH-146).
  const kennzahlen = marker.geometrie ? geoKennzahlen(marker.geometrie) : null;

  const symbolAuswahl = darfSchreiben && onSymbolAendern && TAKTISCHE_TYPEN.includes(marker.typ);

  return (
    <KartenDetailCard titel={marker.label} akzentFarbe={marker.farbe} onSchliessen={onSchliessen}>
      <Tag color={marker.farbe} style={{ marginBottom: token.marginXS }}>
        {TYP_LABEL[marker.typ]}
      </Tag>
      <Descriptions column={1}>
        {marker.typ === 'lagemeldung' && marker.lageMeldung && (
          <Descriptions.Item label="Absender">{marker.lageMeldung.absender}</Descriptions.Item>
        )}
        {marker.typ === 'lagemeldung' && marker.lageMeldung && (
          <Descriptions.Item label="Inhalt">{marker.lageMeldung.inhalt}</Descriptions.Item>
        )}
        <Descriptions.Item label="Koordinate">
          {/* Drei Zeilen statt der vollen rückwärts aufgelösten Adresse: die füllt in der
              300-px-Karte sonst ein halbes Dutzend Zeilen und drückt die Aktionen aus dem
              Blick. Die Koordinate darüber bleibt ungekürzt — sie ist die tragende Angabe.
              Drei und nicht zwei, weil der Tooltip mit dem vollen Wortlaut an `hover`/`focus`
              hängt und die Karte auf Touch bedient wird: was hier steht, muss ohne ihn
              tragen. Wo das nicht reicht, führt der Knopf darunter ins Fach-Modul, das die
              Adresse ungekürzt zeigt. */}
          <KoordinatenAnzeige
            lat={marker.lat}
            lon={marker.lon}
            einsatzId={einsatzId}
            exclude={inspectorExclude(marker, einsatzId)}
            maxOrtZeilen={3}
          />
        </Descriptions.Item>
      </Descriptions>
      {/* Abstand am Aufrufer wie im FachebenenInspector: `GeoKennzahlen` rendert ohne
          Kennzahlen nichts, ein Wrapper mit `marginTop` hinterließe sonst eine leere Lücke —
          und der Punkt-Marker ohne Geometrie ist hier der Regelfall. */}
      {kennzahlen && (
        <div style={{ marginTop: token.marginSM }}>
          <GeoKennzahlen kennzahlen={kennzahlen} />
        </div>
      )}
      {symbolAuswahl && (
        <Space
          orientation="vertical"
          size={token.marginXS}
          style={{ width: '100%', marginTop: token.marginXS }}
        >
          {/* Kein `aria-label` mehr: das FeldLabel trägt den Namen. Zwei Quellen wären eine
              doppelte Benennung, bei der `aria-label` gewinnt und den sichtbaren Text vom
              Accessible Name abkoppelt. */}
          <FeldLabel text="Fachaufgabe" htmlFor={fachaufgabeId}>
            <Select
              id={fachaufgabeId}
              allowClear
              style={{ width: '100%' }}
              value={marker.tz?.fachaufgabe ?? undefined}
              options={FACHAUFGABE_OPTIONEN}
              onChange={(v) => onSymbolAendern!(marker, { tz_fachaufgabe: v ?? null })}
            />
          </FeldLabel>
          <FeldLabel text="Organisation (Override)" htmlFor={organisationId}>
            <Select
              id={organisationId}
              allowClear
              style={{ width: '100%' }}
              value={marker.tz?.organisation ?? undefined}
              options={ORG_OPTIONEN}
              onChange={(v) => onSymbolAendern!(marker, { tz_organisation: v ?? null })}
            />
          </FeldLabel>
        </Space>
      )}
      {/* Senkrecht, nicht nebeneinander: die Karte ist auf 300 px festgelegt, die beiden
          volltextigen Knöpfe tragen zusammen rund 300 px Eigenbreite und passen damit in
          keiner Dichtestufe in den Innenraum. Waagerecht bricht ein `Space` nicht um, und
          `overflowY: 'auto'` an der Karte zieht per CSS auch `overflow-x` auf `auto` — der
          zweite Knopf wurde also abgeschnitten. Dieselbe Bauform wie in `ZonenInspector`
          und `FreiesZeichenInspector` an derselben Karte.
          Kein Dreipunkt-Menü: gezählt wird nach der Rechteprüfung (LFH-366), und ohne
          Schreibrecht bleibt hier genau eine Aktion. */}
      <Space
        orientation="vertical"
        size="middle"
        style={{ width: '100%', marginTop: token.marginXS }}
      >
        {/* `display: block` am Anker: er ist inline, sonst liefe das `block` am Knopf darin
            ins Leere und die Zeile bliebe auf Textbreite. */}
        <Link to={modulLink} style={{ display: 'block' }}>
          <Button block>
            {marker.typ === 'lagemeldung' ? 'Zur Quell-Meldung' : 'Im Fach-Modul öffnen'}
          </Button>
        </Link>
        {/* Lagemeldungen sind auf der Karte read-only: verortet wird ausschließlich beim
            Übergeben (LFH-113). Re-/Ent-Verorten würde am ON-CONFLICT-Upsert ohnehin verpuffen. */}
        {darfSchreiben && marker.typ !== 'einsatzort' && marker.typ !== 'lagemeldung' && (
          <Button danger block onClick={() => onVerortungLoeschen(marker)}>
            Verortung löschen
          </Button>
        )}
      </Space>
    </KartenDetailCard>
  );
}
