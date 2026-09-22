import { Button, Space, Typography } from 'antd';
import { useId, useMemo } from 'react';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import { Select } from '../../components/Select';
import FeldLabel from '../../components/FeldLabel';
import GeoKennzahlen from '../../components/GeoKennzahlen';
import { Link } from 'react-router';
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

/**
 * Das taktische Zeichen als Bild-URL für die Symbol-Kachel — dieselbe Erzeugung wie die
 * Karten-Icons in `Kartenflaeche.tsx`. `null`, wenn das Zeichen sich nicht bauen lässt
 * (nicht DV-102-konforme Werte werfen synchron); dann trägt die Kachel das Kürzel.
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
 * Marker-Inspector im Paneel „Ausgewählt" der rechten Kartenleiste (Neuentwurf S5):
 * Symbol-Kachel mit dem taktischen Zeichen, Name, Mono-Unterzeile (Objektart · Typ),
 * Datenraster in zwei Spalten mit Augenbrauen — nur Felder mit Datenquelle, siehe
 * `auswahlRaster` —, bei einer Einheit die letzte Meldung (LFH-610), Ort, und die Aktionen.
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
  // Eigene ids statt fester Literale: der Inspector kann neben anderen Feldern derselben
  // Beschriftung stehen, doppelte ids brächen die Label-Assoziation.
  const fachaufgabeId = useId();
  const organisationId = useId();
  const modulLink = markerToUrl(marker, einsatzId);
  // Geometrie-Kennzahlen (z. B. Abschnittsfläche), rein clientseitig (LFH-146).
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
      {/* Eigener Block NEBEN dem Raster, nicht darin: ein Meldungstext ist kein Feld mit
          Augenbraue über einem Wert, und im zweispaltigen `dl` bräche er auf die halbe Breite. */}
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
        {/* Drei Zeilen statt der vollen rückwärts aufgelösten Adresse: die füllt die
            300-px-Leiste sonst ein halbes Dutzend Zeilen und drückt die Aktionen aus dem
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
      </div>
      {/* `GeoKennzahlen` rendert ohne Kennzahlen nichts — der Punkt-Marker ohne Geometrie
          ist hier der Regelfall, also kein Wrapper mit eigenem Abstand. */}
      {kennzahlen && <GeoKennzahlen kennzahlen={kennzahlen} />}
      {symbolAuswahl && (
        <Space orientation="vertical" size={token.marginXS} style={{ width: '100%' }}>
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
      {/* Senkrecht, nicht nebeneinander: die Leiste ist 300 px breit, die beiden volltextigen
          Knöpfe tragen zusammen rund 300 px Eigenbreite und passen damit in keiner
          Dichtestufe nebeneinander. Dieselbe Bauform wie in `ZonenInspector` und
          `FreiesZeichenInspector`. Kein Dreipunkt-Menü: gezählt wird nach der Rechteprüfung
          (LFH-366), und es bleiben höchstens zwei Aktionen — ein Menü wäre ein Umweg.
          `size="middle"`: der rote Knopf steht nicht bündig unter dem blauen (LFH-363). */}
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {/* `display: block` am Anker: er ist inline, sonst liefe das `block` am Knopf darin
            ins Leere und die Zeile bliebe auf Textbreite. Das ↗ ist Deeplink-Zeichen des
            Entwurfs und steht `aria-hidden` — der zugängliche Name bleibt die Handlung. */}
        <Link to={modulLink} style={{ display: 'block' }}>
          <Button type="primary" block>
            {marker.typ === 'lagemeldung' ? 'Zur Quell-Meldung' : 'Im Fachmodul öffnen'}
            <span aria-hidden="true">↗</span>
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
