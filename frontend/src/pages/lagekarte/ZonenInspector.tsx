import { Button, Input, Popconfirm, Space, Typography, theme } from 'antd';
import { Link } from 'react-router';
import { Select } from '../../components/Select';
import { useEffect, useId, useRef, useState } from 'react';
import FeldLabel from '../../components/FeldLabel';
import GeoKennzahlen, { KennzahlZeile } from '../../components/GeoKennzahlen';
import type {
  Evakuierungsbezirk,
  Gefahrengebiet,
  KartenAnsicht,
  LageZone,
  ZoneTyp,
} from '../../api/types';
import { gefahrengebietName } from '../../api/gefahren';
import { ZONE_TYPEN, zoneTypLabel, zoneStil } from './zonenStil';
import StatusTag from '../../components/StatusTag';
import { raeumungszustand, warnstufeKarte } from '../../theme/statusFarben';
import { Datenfeld, Datenraster } from '../../components/instrument';
import { evakuiertText } from '../../betreuung/betreuungText';
import { parseGeometry, geoKennzahlen } from './geo';
import KartenDetailCard from './KartenDetailCard';
import AnsichtZuordnung from './AnsichtZuordnung';

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
  }) => Promise<void>;
  onMatrixOeffnen: (gefahrengebietId: number) => void;
  onLoeschen: () => void;
  ansichten: KartenAnsicht[];
  /** Evakuierungsbezirke — leer ohne Lesezugriff auf das Modul Betreuung. */
  bezirke?: Evakuierungsbezirk[];
  /**
   * Darf der Benutzer das Modul Betreuung lesen? Ohne Recht keine Zuordnung und keine
   * Bezirksangaben (der Server lehnte das Setzen mit 403 ab).
   */
  betreuungFrei?: boolean;
  /** Ziel des Sprungs „Im Fachmodul öffnen" zu einem Bezirk (`betreuungPfad(?bezirk=)`). */
  bezirkPfad?: (bezirkId: number) => string;
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
  betreuungFrei = false,
  bezirkPfad,
}: ZonenInspectorProps) {
  const { token } = theme.useToken();
  const gebietId = useId();
  const bezirkFeldId = useId();
  const [entwurf, setEntwurf] = useState(() => ({
    typ: zone.typ,
    label: zone.label ?? '',
    farbe: zone.farbe ?? '#1677ff',
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
      farbe: zone.farbe ?? '#1677ff',
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
  // Geometrie-Kennzahlen rein clientseitig aus der GeoJSON-Geometrie.
  const kennzahlen = geoKennzahlen(parseGeometry(zone.geometrie));

  // Bezirksfläche: der zugeordnete Bezirk, sofern lesbar.
  const istBezirksflaeche = entwurf.typ === 'evakuierungsbezirk';
  const aktuellerBezirk =
    istBezirksflaeche && betreuungFrei
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

  // Nicht-Geo-Zeilen im selben Raster (Warnstufe, Zonen-Anzahl) — null, wenn keine anfallen.
  const zusatzZeilen =
    entwurf.typ === 'gefahrengebiet' && aktuellesGebiet ? (
      <>
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
    ) : null;

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
              if (entwurf.farbe !== (zone.farbe ?? '#1677ff'))
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
              <Button block onClick={() => onMatrixOeffnen(entwurf.gefahrengebiet_id as number)}>
                Gefahrenmatrix bearbeiten
              </Button>
            )}
          </>
        )}

        {istBezirksflaeche && !betreuungFrei && (
          <Typography.Text type="secondary">
            Zuordnung zu einem Evakuierungsbezirk nur mit Zugriff auf das Modul Betreuung
          </Typography.Text>
        )}
        {istBezirksflaeche && betreuungFrei && darfSchreiben && (
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
        {istBezirksflaeche && betreuungFrei && !darfSchreiben && !aktuellerBezirk && (
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
                  aria-label={`Betreuung zu ${aktuellerBezirk.bezeichnung}`}
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

        {/* Rückfrage in jedem Fall: die Zone wird hart gelöscht. Die Warnstufen entscheiden nur
            über den Hinweis. */}
        {darfSchreiben && (
          <Popconfirm
            title="Zone aufheben?"
            description={
              <>
                „{titel}“ wird endgültig gelöscht.
                {aktuellHatWarnstufen &&
                  ' Wird das Gefahrengebiet dadurch leer, geht seine Matrix verloren.'}
              </>
            }
            okText="Aufheben"
            okButtonProps={{ danger: true }}
            cancelText="Abbrechen"
            onConfirm={onLoeschen}
          >
            <Button danger>Zone aufheben</Button>
          </Popconfirm>
        )}
      </Space>
    </KartenDetailCard>
  );
}
