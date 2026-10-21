import { Button, Input, InputNumber, Popconfirm, Space, Typography, theme } from 'antd';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Select } from '../../components/Select';
import { useEffect, useId, useRef, useState } from 'react';
import FeldLabel from '../../components/FeldLabel';
import GeoKennzahlen, { KennzahlZeile } from '../../components/GeoKennzahlen';
import type {
  Evakuierungsbezirk,
  GefahrBewertung,
  Gefahrengebiet,
  KartenAnsicht,
  LageZone,
  ZoneTyp,
} from '../../api/types';
import { gefahrengebietName } from '../../api/gefahren';
import { FREIE_SKIZZE_VORGABEFARBE, ZONE_TYPEN, zoneTypLabel, zoneStil } from './zonenStil';
import StatusTag from '../../components/StatusTag';
import { raeumungszustand, warnstufeKarte } from '../../theme/statusFarben';
import { Augenbraue, Datenfeld, Datenraster, monoStil } from '../../components/instrument';
import { evakuiertText } from '../../betreuung/betreuungText';
import { formatRadius, kreisAusZone, parseGeometry, geoKennzahlen, radiusGueltig } from './geo';
import { KREIS_RADIUS_M_MAX } from '../../api/eingabegrenzen';
import KartenDetailCard from './KartenDetailCard';
import AnsichtZuordnung from './AnsichtZuordnung';
import { KEINE_BERECHTIGUNG } from '../../einsatz/modulRegistry';
import { sprungGesperrtText } from '../../components/Sprung';
import { gefahrenPfad } from '../../routing/deeplinks';
import { gefahrenMatrixAbfrage } from '../gefahren/gefahrenMatrixAbfrage';
import GefahrenStufe from '../gefahren/GefahrenStufe';
import { erlaeuterungEinzeilig, gesetzteGefahren, zellTitel } from '../gefahren/erlaeuterungen';

/** So viele Gefahren zeigt der Inspector, danach „alle in Gefahren ↗“ (LLH-1110). */
export const GEFAHREN_IM_INSPECTOR = 5;

/**
 * Gefahren eines Gefahrengebiets im Inspector (LLH-1110, Spec `gefahrenmatrix`, „Erläuterungen
 * sind sichtbar“): die gesetzten Gefahren (`gesetzteGefahren`: Stufe über „keine“ oder mit
 * Erläuterung) in der Folge der Matrix, kompakt bis {@link GEFAHREN_IM_INSPECTOR}, dann der Sprung
 * zur Gefahrenseite. Die Erläuterung steht zweizeilig, länger endet mit „…“ und steht ganz im
 * `title`. „Gemeldet von“ und „geändert“ trägt die Liste der Gefahrenseite, nicht die Karte.
 * Lädt die Matrix noch, steht nichts: keine Aussage, die niemand geprüft hat.
 */
function GefahrenImGebiet({
  matrix,
  fehler,
  einsatzId,
  gebietId,
}: {
  matrix: readonly GefahrBewertung[] | undefined;
  fehler: boolean;
  einsatzId: number;
  gebietId: number;
}) {
  const { token } = theme.useToken();
  const titelId = useId();
  const gefahren = matrix ? gesetzteGefahren(matrix) : [];
  return (
    <section
      aria-labelledby={titelId}
      data-lfh="inspector-gefahren"
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}
    >
      {/* h4 unter dem h3 des Inspectors (`KartenDetailCard`). */}
      <Augenbraue als="h4" id={titelId}>
        Gefahren
      </Augenbraue>
      {fehler ? (
        <Typography.Text type="danger">Gefahren nicht geladen</Typography.Text>
      ) : matrix == null ? null : gefahren.length === 0 ? (
        <Typography.Text type="secondary">keine Gefahr über „keine“</Typography.Text>
      ) : (
        <>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: token.marginXS,
            }}
          >
            {gefahren.slice(0, GEFAHREN_IM_INSPECTOR).map((z) => {
              const text = erlaeuterungEinzeilig(z);
              return (
                <li key={z.id} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'baseline',
                      gap: token.marginXS,
                    }}
                  >
                    <GefahrenStufe stufe={z.warnstufe} />
                    <span>{zellTitel(z.gefahrentyp, z.schutzobjekt)}</span>
                  </span>
                  {text && (
                    <Typography.Text
                      type="secondary"
                      title={text}
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {text}
                    </Typography.Text>
                  )}
                </li>
              );
            })}
          </ul>
          {gefahren.length > GEFAHREN_IM_INSPECTOR && (
            // Ein Sprung ist keine Handlung (LFH-616): eigene Zeile, das ↗ ohne Vorlesen.
            <div data-lfh="inspector-sprung">
              <Link to={gefahrenPfad(einsatzId, { gefahrengebiet: gebietId })}>
                alle in Gefahren <span aria-hidden="true">↗</span>
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Sentinel im Dropdown für „in neues Gefahrengebiet abspalten". */
const NEU = -1;
/** Sentinel im Bezirks-Dropdown für „nicht zugeordnet". */
const KEIN_BEZIRK = -1;

export interface ZonenInspectorProps {
  zone: LageZone;
  gebiete: Gefahrengebiet[];
  darfSchreiben: boolean;
  onSchliessen: () => void;
  /** Partielles PATCH (nur geänderte Felder). */
  onAendern: (patch: {
    typ?: ZoneTyp;
    label?: string | null;
    farbe?: string | null;
    notiz?: string | null;
    gefahrengebiet_id?: number | null;
    ansicht_id?: number | null;
    evakuierungsbezirk_id?: number | null;
    /** Nur an einer Kreiszone (LLH-1043): der Server rechnet das Polygon um dieselbe Mitte neu. */
    kreis_radius_m?: number;
  }) => Promise<void>;
  onMatrixOeffnen: (gefahrengebietId: number) => void;
  onLoeschen: () => void;
  ansichten: KartenAnsicht[];
  /** Evakuierungsbezirke — leer ohne Lesezugriff auf das Modul Evakuierung (LLH-1034). */
  bezirke?: Evakuierungsbezirk[];
  /**
   * Darf der Benutzer das Modul Evakuierung lesen? Ohne Recht keine Zuordnung und keine
   * Bezirksangaben (der Server lehnte das Setzen mit 403 ab).
   */
  evakuierungFrei?: boolean;
  /** Ziel des Sprungs „Im Fachmodul öffnen" zu einem Bezirk (Detailseite, `evakuierungsbezirkPfad`). */
  bezirkPfad?: (bezirkId: number) => string;
  /** Zielmodul Gefahren gesperrt: „Gefahrenmatrix bearbeiten" steht gesperrt (LFH-888). */
  matrixGesperrt?: boolean;
  /** „Punkte bearbeiten“ (LLH-1344): die Zone punktweise an der Karte ändern. */
  onPunkteBearbeiten?: () => void;
  /** „Mitte verschieben“ (LLH-1344), nur an einer Kreiszone. */
  onMitteVerschieben?: () => void;
}

export default function ZonenInspector({
  zone,
  gebiete,
  darfSchreiben,
  onSchliessen,
  onAendern,
  onMatrixOeffnen,
  onLoeschen,
  ansichten,
  bezirke = [],
  evakuierungFrei = false,
  bezirkPfad,
  matrixGesperrt = false,
  onPunkteBearbeiten,
  onMitteVerschieben,
}: ZonenInspectorProps) {
  const { token } = theme.useToken();
  const gebietId = useId();
  const bezirkFeldId = useId();
  const [entwurf, setEntwurf] = useState(() => ({
    typ: zone.typ,
    label: zone.label ?? '',
    farbe: zone.farbe ?? FREIE_SKIZZE_VORGABEFARBE,
    notiz: zone.notiz ?? '',
    gefahrengebiet_id: zone.gefahrengebiet_id,
    ansicht_id: zone.ansicht_id,
    evakuierungsbezirk_id: zone.evakuierungsbezirk_id ?? null,
  }));
  const [speicherStatus, setSpeicherStatus] = useState<
    'idle' | 'speichert' | 'gespeichert' | 'fehler'
  >('idle');
  const speicherLauf = useRef(0);
  const entwurfZoneId = useRef(zone.id);
  // Kreiszone (LLH-1043, design.md D10): Radius als Kennzahl und als Zahl änderbar.
  const kreis = kreisAusZone(zone);
  const gespeicherterRadius = kreis?.radiusM ?? null;
  const [radiusEntwurf, setRadiusEntwurf] = useState<number | null>(gespeicherterRadius);
  // Der gespeicherte Radius ist die Wahrheit: nach dem eigenen PATCH, über SSE und beim
  // Zonenwechsel steht er wieder im Feld.
  useEffect(() => setRadiusEntwurf(gespeicherterRadius), [zone.id, gespeicherterRadius]);
  const radiusSpeichern = () => {
    if (gespeicherterRadius == null) return;
    if (!radiusGueltig(radiusEntwurf)) {
      setRadiusEntwurf(gespeicherterRadius);
      return;
    }
    if (Math.round(radiusEntwurf) !== Math.round(gespeicherterRadius))
      void speichern({ kreis_radius_m: Math.round(radiusEntwurf) });
  };

  useEffect(() => {
    // Same-ID-Updates können jederzeit über SSE/Refetch eintreffen; der kontrollierte Entwurf darf
    // dabei nicht überschrieben werden, solange Label/Notiz auf ihren Blur warten. Bei einer
    // anderen Zone ist ein Vollreset richtig.
    if (entwurfZoneId.current === zone.id) return;
    entwurfZoneId.current = zone.id;
    // Ein auf der alten Zone gestarteter Speichervorgang darf an der neuen keine Quittung
    // hinterlassen — der Zähler invalidiert den nachlaufenden Lauf.
    speicherLauf.current++;
    setEntwurf({
      typ: zone.typ,
      label: zone.label ?? '',
      farbe: zone.farbe ?? FREIE_SKIZZE_VORGABEFARBE,
      notiz: zone.notiz ?? '',
      gefahrengebiet_id: zone.gefahrengebiet_id,
      ansicht_id: zone.ansicht_id,
      evakuierungsbezirk_id: zone.evakuierungsbezirk_id ?? null,
    });
    setSpeicherStatus('idle');
  }, [
    zone.id,
    zone.typ,
    zone.label,
    zone.farbe,
    zone.notiz,
    zone.gefahrengebiet_id,
    zone.ansicht_id,
    zone.evakuierungsbezirk_id,
  ]);

  async function speichern(patch: Parameters<ZonenInspectorProps['onAendern']>[0]) {
    const lauf = ++speicherLauf.current;
    setSpeicherStatus('speichert');
    try {
      await onAendern(patch);
      if (speicherLauf.current === lauf) setSpeicherStatus('gespeichert');
    } catch {
      if (speicherLauf.current === lauf) setSpeicherStatus('fehler');
    }
  }

  const gesperrt = !darfSchreiben || speicherStatus === 'speichert';
  const istFreieSkizze = entwurf.typ === 'freie_skizze';
  const erlaubteTypen = ZONE_TYPEN.filter(
    (t) => t.geometrie === 'beides' || t.geometrie === zone.geometrie_typ,
  );
  const aktuellesGebiet = gebiete.find((g) => g.id === entwurf.gefahrengebiet_id) ?? null;
  const aktuellHatWarnstufen = (aktuellesGebiet?.hoechste_warnstufe ?? 'keine') !== 'keine';
  // Gefahren des Gebiets (LLH-1110): nur mit Freigabe Gefahren (die Gebietsliste kommt nur mit
  // ihr, LFH-669; gesperrt heißt `matrixGesperrt`, LFH-888) und nicht im Historien-Modus — dort
  // zeigt die Karte einen eingefrorenen Stand, die Matrix wäre die heutige. Abruf über dieselbe
  // Abfrage wie die Gefahrenseite: gemeinsamer Cache, live über das Ereignis `gefahr`.
  const [suchParameter] = useSearchParams();
  const matrixGebietId =
    entwurf.typ === 'gefahrengebiet' &&
    aktuellesGebiet != null &&
    !matrixGesperrt &&
    !suchParameter.has('snapshot')
      ? aktuellesGebiet.id
      : null;
  const matrixQuery = useQuery({
    ...gefahrenMatrixAbfrage(zone.einsatz_id, matrixGebietId),
    enabled: matrixGebietId != null,
  });
  // Geometrie-Kennzahlen rein clientseitig aus der GeoJSON-Geometrie.
  const kennzahlen = geoKennzahlen(parseGeometry(zone.geometrie));

  // Bezirksfläche: der zugeordnete Bezirk, sofern lesbar.
  const istBezirksflaeche = entwurf.typ === 'evakuierungsbezirk';
  const aktuellerBezirk =
    istBezirksflaeche && evakuierungFrei
      ? (bezirke.find((b) => b.id === entwurf.evakuierungsbezirk_id) ?? null)
      : null;
  const bezirkZuordnen = (ziel: number) => {
    const evakuierungsbezirk_id = ziel === KEIN_BEZIRK ? null : ziel;
    setEntwurf((alt) => ({ ...alt, evakuierungsbezirk_id }));
    void speichern({ evakuierungsbezirk_id });
  };

  const umhaengen = (ziel: number) => {
    const gefahrengebiet_id = ziel === NEU ? null : ziel;
    setEntwurf((alt) => ({ ...alt, gefahrengebiet_id }));
    void speichern({ gefahrengebiet_id });
  };

  // Nicht-Geo-Zeilen im selben Raster (Radius, Warnstufe, Zonen-Anzahl) — null, wenn keine
  // anfallen.
  const radiusZeile = kreis ? (
    <KennzahlZeile label="Radius" wert={formatRadius(kreis.radiusM)} />
  ) : null;
  const zusatzZeilen =
    entwurf.typ === 'gefahrengebiet' && aktuellesGebiet ? (
      <>
        {radiusZeile}
        {aktuellHatWarnstufen && (
          <KennzahlZeile
            label="Höchste Warnstufe"
            zahl={false}
            /* Kartenlesart, nicht Kennzahllesart: der Inspektor beschreibt ein Objekt, deshalb
               ist `keine` hier `alarm` — unbewertet gilt vorsichtshalber als Gefahr. */
            wert={<StatusTag darstellung={warnstufeKarte[aktuellesGebiet.hoechste_warnstufe]} />}
          />
        )}
        <KennzahlZeile label="Zonen" wert={String(aktuellesGebiet.zonen_ids.length)} />
      </>
    ) : (
      radiusZeile
    );

  const titel = entwurf.label.trim() ? entwurf.label : zoneTypLabel(entwurf.typ);

  return (
    <KartenDetailCard
      titel={titel}
      akzentFarbe={zoneStil(entwurf.typ, entwurf.farbe).lineColor}
      onSchliessen={onSchliessen}
    >
      <Space orientation="vertical" style={{ width: '100%' }}>
        {darfSchreiben ? (
          <Select<ZoneTyp>
            aria-label="Zonen-Typ"
            value={entwurf.typ}
            style={{ width: '100%' }}
            disabled={gesperrt}
            options={erlaubteTypen.map((t) => ({ value: t.typ, label: t.label }))}
            onChange={(typ) => {
              setEntwurf((alt) => ({ ...alt, typ }));
              void speichern({ typ });
            }}
          />
        ) : (
          <Typography.Text>{zoneTypLabel(zone.typ)}</Typography.Text>
        )}

        {/* Warnstufe und Zonen-Anzahl stehen im selben Label→Wert-Raster (`zusatz`-Slot); die
            Warnstufe ist ein Tag und läuft mit `zahl={false}` an der Zahlenschrift vorbei.

            Die Bedingung steht hier: antds `Space` wickelt auch eine Komponente, die null
            rendert, in ein `.ant-space-item` — ohne Kennzahlen gäbe das eine leere Lücke. */}
        {(kennzahlen || zusatzZeilen) && (
          <GeoKennzahlen kennzahlen={kennzahlen} zusatz={zusatzZeilen} />
        )}

        {matrixGebietId != null && (
          <GefahrenImGebiet
            matrix={matrixQuery.data}
            fehler={matrixQuery.isError}
            einsatzId={zone.einsatz_id}
            gebietId={matrixGebietId}
          />
        )}

        {kreis && darfSchreiben && (
          <InputNumber<number>
            aria-label="Radius in Metern"
            value={radiusEntwurf}
            min={1}
            max={KREIS_RADIUS_M_MAX}
            precision={0}
            suffix="m"
            inputMode="numeric"
            disabled={gesperrt}
            style={{ width: '100%', ...monoStil(token.fontSize) }}
            onChange={(v) => setRadiusEntwurf(typeof v === 'number' ? v : null)}
            onBlur={radiusSpeichern}
            onPressEnter={radiusSpeichern}
          />
        )}

        {/* Bearbeiten an der Karte (LLH-1344): beide Wege starten einen Kartenmodus und schließen
            den Inspector; danach steht die Zone wieder hier. */}
        {darfSchreiben && (onPunkteBearbeiten || (kreis && onMitteVerschieben)) && (
          <Space wrap data-lfh="zone-bearbeiten">
            {kreis && onMitteVerschieben && (
              <Button disabled={gesperrt} onClick={onMitteVerschieben}>
                Mitte verschieben
              </Button>
            )}
            {onPunkteBearbeiten && (
              <Button disabled={gesperrt} onClick={onPunkteBearbeiten}>
                Punkte bearbeiten
              </Button>
            )}
          </Space>
        )}

        <Input
          aria-label="Label"
          placeholder="Bezeichnung"
          value={entwurf.label}
          disabled={gesperrt}
          onChange={(e) => setEntwurf((alt) => ({ ...alt, label: e.target.value }))}
          onBlur={() => {
            const label = entwurf.label.trim();
            setEntwurf((alt) => ({ ...alt, label }));
            if (label !== (zone.label ?? '')) void speichern({ label: label || null });
          }}
        />

        {istFreieSkizze && (
          <Input
            aria-label="Farbe"
            type="color"
            value={entwurf.farbe}
            disabled={gesperrt}
            onChange={(e) => setEntwurf((alt) => ({ ...alt, farbe: e.target.value }))}
            onBlur={() => {
              if (entwurf.farbe !== (zone.farbe ?? FREIE_SKIZZE_VORGABEFARBE))
                void speichern({ farbe: entwurf.farbe });
            }}
          />
        )}

        {entwurf.typ === 'gefahrengebiet' && (
          <>
            {/* Das FeldLabel trägt den Namen. */}
            <FeldLabel text="Gehört zu Gefahrengebiet" htmlFor={gebietId}>
              <Select<number>
                id={gebietId}
                style={{ width: '100%' }}
                value={entwurf.gefahrengebiet_id ?? undefined}
                disabled={gesperrt}
                options={[
                  ...gebiete.map((g) => ({
                    value: g.id,
                    label: gefahrengebietName(g.label, g.id),
                  })),
                  { value: NEU, label: '+ Neues Gefahrengebiet' },
                ]}
                onChange={(v) => umhaengen(v)}
              />
            </FeldLabel>
            {entwurf.gefahrengebiet_id != null && (
              <Button
                block
                disabled={matrixGesperrt}
                title={matrixGesperrt ? KEINE_BERECHTIGUNG : undefined}
                onClick={() => onMatrixOeffnen(entwurf.gefahrengebiet_id as number)}
              >
                {/* Der Grund steht im Text: ein `title` erscheint auf Touch nie. */}
                {matrixGesperrt
                  ? sprungGesperrtText('Gefahrenmatrix bearbeiten')
                  : 'Gefahrenmatrix bearbeiten'}
              </Button>
            )}
          </>
        )}

        {/* Grund in wenigen Wörtern als Lesezeile (LFH-1083): ein gesperrtes Select läse der
            Vorleser ohne seinen Platzhalter. */}
        {istBezirksflaeche && !evakuierungFrei && (
          <Typography.Text type="secondary">
            Evakuierungsbezirk · kein Zugriff auf Evakuierung
          </Typography.Text>
        )}
        {istBezirksflaeche && evakuierungFrei && darfSchreiben && (
          <FeldLabel text="Gehört zu Evakuierungsbezirk" htmlFor={bezirkFeldId}>
            <Select<number>
              id={bezirkFeldId}
              style={{ width: '100%' }}
              value={entwurf.evakuierungsbezirk_id ?? KEIN_BEZIRK}
              disabled={gesperrt}
              options={[
                { value: KEIN_BEZIRK, label: 'nicht zugeordnet' },
                ...bezirke.map((b) => ({ value: b.id, label: b.bezeichnung })),
                // Zugeordnet, aber (noch) nicht in der Liste — die Übersicht lädt, oder der Bezirk
                // wurde eben storniert. Sonst stünde die rohe id im Feld.
                ...(entwurf.evakuierungsbezirk_id != null &&
                !bezirke.some((b) => b.id === entwurf.evakuierungsbezirk_id)
                  ? [{ value: entwurf.evakuierungsbezirk_id, label: 'Bezirk nicht verfügbar' }]
                  : []),
              ]}
              onChange={(v) => bezirkZuordnen(v)}
            />
          </FeldLabel>
        )}
        {istBezirksflaeche && evakuierungFrei && !darfSchreiben && !aktuellerBezirk && (
          <Typography.Text type="secondary">keinem Evakuierungsbezirk zugeordnet</Typography.Text>
        )}
        {aktuellerBezirk && (
          <>
            <Datenraster
              beschriftung={`Evakuierungsbezirk ${aktuellerBezirk.bezeichnung}`}
              spalten={1}
            >
              {!darfSchreiben && (
                <Datenfeld label="Bezirk">{aktuellerBezirk.bezeichnung}</Datenfeld>
              )}
              <Datenfeld label="Räumung">
                <StatusTag darstellung={raeumungszustand[aktuellerBezirk.raeumung]} />
              </Datenfeld>
              <Datenfeld label="Evakuiert" mono>
                {evakuiertText(aktuellerBezirk)}
              </Datenfeld>
            </Datenraster>
            {bezirkPfad && (
              // Ein Sprung ist keine Handlung: eigene Zeile, der zugängliche Name trägt den Bezirk,
              // das ↗ steht `aria-hidden`.
              <div
                data-lfh="inspector-sprung"
                style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}
              >
                <Link
                  to={bezirkPfad(aktuellerBezirk.id)}
                  aria-label={`Evakuierung zu ${aktuellerBezirk.bezeichnung}`}
                  style={{ display: 'block', flex: '1 1 auto' }}
                >
                  <Button block>
                    Im Fachmodul öffnen<span aria-hidden="true">↗</span>
                  </Button>
                </Link>
              </div>
            )}
          </>
        )}

        <Input.TextArea
          aria-label="Notiz"
          placeholder="Notiz"
          value={entwurf.notiz}
          disabled={gesperrt}
          rows={2}
          onChange={(e) => setEntwurf((alt) => ({ ...alt, notiz: e.target.value }))}
          onBlur={() => {
            const notiz = entwurf.notiz.trim();
            setEntwurf((alt) => ({ ...alt, notiz }));
            if (notiz !== (zone.notiz ?? '')) void speichern({ notiz: notiz || null });
          }}
        />

        <AnsichtZuordnung
          ansichten={ansichten}
          wert={entwurf.ansicht_id}
          disabled={gesperrt}
          onChange={(ansicht_id) => {
            setEntwurf((alt) => ({ ...alt, ansicht_id }));
            void speichern({ ansicht_id });
          }}
        />

        {speicherStatus !== 'idle' && (
          <Typography.Text
            type={speicherStatus === 'fehler' ? 'danger' : 'secondary'}
            aria-live="polite"
          >
            {speicherStatus === 'speichert'
              ? 'speichert …'
              : speicherStatus === 'gespeichert'
                ? 'gespeichert'
                : 'nicht gespeichert'}
          </Typography.Text>
        )}
      </Space>
      {/* Rückfrage in jedem Fall: die Zone wird hart gelöscht. Die Warnstufen entscheiden nur
          über den Hinweis. Abgesetzt unter der Reihe um `token.padding` (= `size="middle"`): die
          neutralen Knöpfe darin (Gefahrenmatrix, Sprung ins Fachmodul) sind keine Nachbarn
          (`aktionsabstand.guard.test.ts`, `OHNE_NACHBARSCHAFT`). */}
      {darfSchreiben && (
        <div style={{ marginTop: token.padding }}>
          <Popconfirm
            title={`Zone „${titel}“ aufheben?`}
            description={
              aktuellHatWarnstufen
                ? 'Wird das Gefahrengebiet dadurch leer, geht seine Matrix verloren.'
                : undefined
            }
            okText="Zone aufheben"
            okButtonProps={{ danger: true }}
            cancelText="Abbrechen"
            onConfirm={onLoeschen}
          >
            <Button danger>Zone aufheben</Button>
          </Popconfirm>
        </div>
      )}
    </KartenDetailCard>
  );
}
