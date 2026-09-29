import { Button, Popconfirm, Space, Typography } from 'antd';
import { useId, useMemo } from 'react';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import { Select } from '../../components/Select';
import FeldLabel from '../../components/FeldLabel';
import GeoKennzahlen from '../../components/GeoKennzahlen';
import { Link } from 'react-router';
import { etbPfad } from '../../routing/deeplinks';
import type { KarteMarker, MarkerTyp } from './marker';
import { markerToUrl } from './markerToUrl';
import { geoKennzahlen } from './geo';
import KartenDetailCard from './KartenDetailCard';
import KoordinatenAnzeige from '../../anzeige/KoordinatenAnzeige';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import {
  Augenbraue,
  StatusChip,
  monoStil,
  tonVonRolle,
  useRollen,
} from '../../components/instrument';
import {
  LEERE_ROHDATEN,
  auswahlRaster,
  auswahlUnterzeile,
  letzteMeldungBlock,
  type AuswahlRoh,
  type RasterFeld,
} from './leistenDaten';
import type { TzProps } from './taktischesZeichen';

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
  /** Rohlisten für das Datenraster (Stärke, Abschnitt, Status …); ohne Angabe nur Ort. */
  roh?: AuswahlRoh;
}

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

/**
 * Marker-Typ → Backend-Tag für den exclude-Parameter der Ort-Vorschau. `fuehrung` → `personal`
 * (Führungskraft liegt in der personal-Tabelle); `abschnitt` hat kein eindeutiges Tag → undefined.
 */
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
    // Betroffene stehen in keiner Peilungsquelle der Ort-Vorschau (sie prüft nur den
    // Einsatz-Lesezugriff und darf keine Personen kennen).
    case 'person':
      return undefined;
    // Betreuungsstellen ebenso: die Peilung kennt nur, was jeder Einsatz-Leser sehen darf.
    case 'betreuungsstelle':
      return undefined;
  }
}

/**
 * Das taktische Zeichen als Bild-URL für die Symbol-Kachel — wie die Karten-Icons in
 * `Kartenflaeche.tsx`. `null`, wenn es sich nicht bauen lässt (nicht DV-102-konforme Werte werfen
 * synchron); dann trägt die Kachel das Kürzel.
 */
function tzBildUrl(tz: TzProps | undefined): string | null {
  if (!tz) return null;
  try {
    return erzeugeTaktischesZeichen(tz).dataUrl;
  } catch {
    return null;
  }
}

/** Ein Feld des Datenrasters: Augenbraue über dem Wert; mit Statusrolle als getönter Chip. */
function RasterZelle({ feld }: { feld: RasterFeld }) {
  const { rollen } = useRollen();
  const ton = feld.rolle ? tonVonRolle(feld.rolle) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <Augenbraue als="dt">{feld.label}</Augenbraue>
      <dd style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
        {ton ? (
          <StatusChip ton={ton} wort={feld.wert} />
        ) : (
          <span
            style={
              feld.mono === false
                ? { fontSize: 13, color: rollen.text }
                : { ...monoStil(15), color: rollen.text }
            }
          >
            {feld.wert}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Marker-Inspector im Paneel „Ausgewählt": Symbol-Kachel, Name, Mono-Unterzeile, Datenraster (nur
 * Felder mit Datenquelle, siehe `auswahlRaster`), bei einer Einheit die letzte Meldung, Ort und
 * Aktionen.
 */
export default function Inspector({
  einsatzId,
  marker,
  darfSchreiben,
  onSchliessen,
  onVerortungLoeschen,
  onSymbolAendern,
  roh = LEERE_ROHDATEN,
}: InspectorProps) {
  const { token, rollen } = useRollen();
  const { formatZeitKurz } = useAnzeigeKonventionen();
  // Eigene ids: der Inspector kann neben Feldern derselben Beschriftung stehen.
  const fachaufgabeId = useId();
  const organisationId = useId();
  const modulLink = markerToUrl(marker, einsatzId);
  // Geometrie-Kennzahlen (z. B. Abschnittsfläche), rein clientseitig.
  const kennzahlen = marker.geometrie ? geoKennzahlen(marker.geometrie) : null;
  const bild = useMemo(() => tzBildUrl(marker.tz), [marker.tz]);
  const raster = auswahlRaster(marker, roh, formatZeitKurz);
  const letzte = letzteMeldungBlock(marker, roh, formatZeitKurz);

  const symbolAuswahl = darfSchreiben && onSymbolAendern && TAKTISCHE_TYPEN.includes(marker.typ);

  return (
    <KartenDetailCard
      titel={marker.label}
      akzentFarbe={marker.farbe}
      onSchliessen={onSchliessen}
      unterzeile={auswahlUnterzeile(marker, roh)}
      kachel={
        bild ? (
          <img
            src={bild}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : undefined
      }
    >
      {raster.length > 0 && (
        <dl
          data-lfh="auswahl-raster"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: token.marginSM,
            margin: 0,
          }}
        >
          {raster.map((f) => (
            <RasterZelle key={f.label} feld={f} />
          ))}
        </dl>
      )}
      {/* Eigener Block neben dem Raster: ein Meldungstext ist kein Feld, und im zweispaltigen
          `dl` bräche er auf halbe Breite. */}
      {letzte && (
        <section
          data-lfh="auswahl-letzte-meldung"
          aria-label="Letzte Meldung"
          style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}
        >
          <Augenbraue>Letzte Meldung</Augenbraue>
          <span
            style={{ fontSize: 12, lineHeight: 1.5, color: rollen.text2, overflowWrap: 'anywhere' }}
          >
            {letzte.text}
          </span>
          <span style={{ ...monoStil(10), color: rollen.schwach }}>{letzte.meta}</span>
        </section>
      )}
      {marker.typ === 'lagemeldung' && marker.lageMeldung && (
        <Typography.Paragraph style={{ margin: 0, fontSize: 12, color: rollen.text2 }}>
          {marker.lageMeldung.inhalt}
        </Typography.Paragraph>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Augenbraue>Koordinate</Augenbraue>
        {/* Drei Zeilen statt der vollen Adresse, die die 300-px-Leiste sonst füllte. Nicht zwei:
            der Tooltip mit dem vollen Wortlaut hängt an Hover/Fokus, und auf Touch muss das
            Sichtbare tragen. Die Koordinate darüber bleibt ungekürzt. */}
        <KoordinatenAnzeige
          lat={marker.lat}
          lon={marker.lon}
          einsatzId={einsatzId}
          exclude={inspectorExclude(marker, einsatzId)}
          maxOrtZeilen={3}
        />
      </div>
      {/* `GeoKennzahlen` rendert ohne Kennzahlen nichts — also kein Wrapper mit Abstand. */}
      {kennzahlen && <GeoKennzahlen kennzahlen={kennzahlen} />}
      {symbolAuswahl && (
        <Space orientation="vertical" size={token.marginXS} style={{ width: '100%' }}>
          {/* Das FeldLabel trägt den Namen; ein zusätzliches `aria-label` gewönne und koppelte
              den sichtbaren Text vom Accessible Name ab. */}
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
      {/* Senkrecht: die zwei volltextigen Knöpfe passen in der 300-px-Leiste in keiner
          Dichtestufe nebeneinander (wie `ZonenInspector`, `FreiesZeichenInspector`). Kein
          Dreipunkt-Menü: es bleiben höchstens zwei Handlungen. Die Sprünge „Im Fachmodul öffnen"
          und „ETB" zählen als eine Zeile Navigation, nicht als Aktionen. `size="middle"`: Rot
          steht nicht bündig unter Blau. */}
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {/* Umbrechende Zeile: in der Handschuh-Stufe bricht „ETB ↗" unter den Fachmodul-Knopf,
            statt abgeschnitten zu werden. */}
        <div
          data-lfh="inspector-sprung"
          style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}
        >
          {/* `display: block` am inline-Anker, sonst bliebe die Zeile auf Textbreite. Das ↗
              steht `aria-hidden`. */}
          <Link to={modulLink} style={{ display: 'block', flex: '1 1 auto' }}>
            <Button type="primary" block>
              {marker.typ === 'lagemeldung' ? 'Zur Quell-Meldung' : 'Im Fachmodul öffnen'}
              <span aria-hidden="true">↗</span>
            </Button>
          </Link>
          {marker.typ === 'einheit' && (
            // Der zugängliche Name trägt die Einheit: „ETB" allein sagte nicht, wessen.
            <Link
              to={etbPfad(einsatzId, { einheit_id: marker.id })}
              aria-label={`Einsatztagebuch zu ${marker.label}`}
              style={{ display: 'block', flex: '1 1 auto' }}
            >
              <Button block>
                ETB<span aria-hidden="true">↗</span>
              </Button>
            </Link>
          )}
        </div>
        {/* Lagemeldungen sind auf der Karte read-only: verortet wird nur beim Übergeben. */}
        {darfSchreiben &&
          marker.typ !== 'einsatzort' &&
          marker.typ !== 'lagemeldung' &&
          (marker.typ === 'abschnitt' ? (
            // Ein Abschnitt steht nur mit Fläche auf der Karte, sein Löschen schickt
            // `flaeche_geojson: null` — unumkehrbar, also Rückfrage. Käme je ein Abschnitt als
            // Punkt dazu, gehörte diese Bedingung an die Geometrie.
            <Popconfirm
              title={`Fläche von „${marker.label}“ löschen?`}
              description="Die gezeichnete Fläche geht verloren und muss neu gezeichnet werden."
              okText="Löschen"
              okButtonProps={{ danger: true }}
              cancelText="Abbrechen"
              onConfirm={() => onVerortungLoeschen(marker)}
            >
              <Button danger block>
                Verortung löschen
              </Button>
            </Popconfirm>
          ) : (
            // Ein Punkt lässt sich über „Auf Karte verorten" neu setzen: umkehrbar, keine
            // Rückfrage.
            <Button danger block onClick={() => onVerortungLoeschen(marker)}>
              Verortung löschen
            </Button>
          ))}
      </Space>
    </KartenDetailCard>
  );
}
