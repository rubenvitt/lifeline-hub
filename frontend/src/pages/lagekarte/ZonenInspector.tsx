import { Button, Input, Popconfirm, Space, Typography } from 'antd';
import { Select } from '../../components/Select';
import { useEffect, useId, useRef, useState } from 'react';
import FeldLabel from '../../components/FeldLabel';
import GeoKennzahlen, { KennzahlZeile } from '../../components/GeoKennzahlen';
import type { Gefahrengebiet, KartenAnsicht, LageZone, ZoneTyp } from '../../api/types';
import { gefahrengebietName } from '../../api/gefahren';
import { ZONE_TYPEN, zoneTypLabel, zoneStil } from './zonenStil';
import StatusTag from '../../components/StatusTag';
import { warnstufeKarte } from '../../theme/statusFarben';
import { parseGeometry, geoKennzahlen } from './geo';
import KartenDetailCard from './KartenDetailCard';
import AnsichtZuordnung from './AnsichtZuordnung';

/** Sentinel im Dropdown für „in neues Gefahrengebiet abspalten". */
const NEU = -1;

export interface ZonenInspectorProps {
  zone: LageZone;
  gebiete: Gefahrengebiet[];
  darfSchreiben: boolean;
  onSchliessen: () => void;
  /** Partielles PATCH (nur geänderte Felder). */
  onAendern: (patch: { typ?: ZoneTyp; label?: string | null; farbe?: string | null; notiz?: string | null; gefahrengebiet_id?: number | null; ansicht_id?: number | null }) => Promise<void>;
  onMatrixOeffnen: (gefahrengebietId: number) => void;
  onLoeschen: () => void;
  /** Ansichts-Zuordnung (B/LFH-320). */
  ansichten: KartenAnsicht[];
}

export default function ZonenInspector({ zone, gebiete, darfSchreiben, onSchliessen, onAendern, onMatrixOeffnen, onLoeschen, ansichten }: ZonenInspectorProps) {
  const gebietId = useId();
  const [entwurf, setEntwurf] = useState(() => ({
    typ: zone.typ,
    label: zone.label ?? '',
    farbe: zone.farbe ?? '#1677ff',
    notiz: zone.notiz ?? '',
    gefahrengebiet_id: zone.gefahrengebiet_id,
    ansicht_id: zone.ansicht_id,
  }));
  const [speicherStatus, setSpeicherStatus] = useState<'idle' | 'speichert' | 'gespeichert' | 'fehler'>('idle');
  const speicherLauf = useRef(0);
  const entwurfZoneId = useRef(zone.id);

  useEffect(() => {
    // Same-ID-Updates koennen jederzeit ueber SSE/Refetch eintreffen. Der kontrollierte
    // Entwurf darf dabei nicht mit Serverwerten ueberschrieben werden, solange Label/Notiz
    // noch auf ihren Blur warten. Bei einer wirklich anderen Zone ist ein Vollreset richtig.
    if (entwurfZoneId.current === zone.id) return;
    entwurfZoneId.current = zone.id;
    // Ein auf der ALTEN Zone gestarteter Speichervorgang darf nach dem Wechsel keine
    // Quittung („gespeichert"/„nicht gespeichert") an der neuen Zone hinterlassen —
    // der Zähler invalidiert den nachlaufenden Lauf wie der Reset den Entwurf (LFH-349).
    speicherLauf.current++;
    setEntwurf({
      typ: zone.typ,
      label: zone.label ?? '',
      farbe: zone.farbe ?? '#1677ff',
      notiz: zone.notiz ?? '',
      gefahrengebiet_id: zone.gefahrengebiet_id,
      ansicht_id: zone.ansicht_id,
    });
    setSpeicherStatus('idle');
  }, [zone.id, zone.typ, zone.label, zone.farbe, zone.notiz, zone.gefahrengebiet_id, zone.ansicht_id]);

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
  const erlaubteTypen = ZONE_TYPEN.filter((t) => t.geometrie === 'beides' || t.geometrie === zone.geometrie_typ);
  const aktuellesGebiet = gebiete.find((g) => g.id === entwurf.gefahrengebiet_id) ?? null;
  const aktuellHatWarnstufen = (aktuellesGebiet?.hoechste_warnstufe ?? 'keine') !== 'keine';
  // Geometrie-Kennzahlen rein clientseitig aus der GeoJSON-Geometrie (LFH-146).
  const kennzahlen = geoKennzahlen(parseGeometry(zone.geometrie));

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
            /* Kartenlesart, nicht Kennzahllesart: der Inspektor beschreibt EIN Objekt
               (dieses Gefahrengebiet), nicht eine Verdichtung über viele. `keine` ist
               hier deshalb `alarm` — unbewertet gilt vorsichtshalber als Gefahr. */
            wert={<StatusTag darstellung={warnstufeKarte[aktuellesGebiet.hoechste_warnstufe]} />}
          />
        )}
        <KennzahlZeile label="Zonen" wert={String(aktuellesGebiet.zonen_ids.length)} />
      </>
    ) : null;

  return (
    <KartenDetailCard
      titel={entwurf.label.trim() ? entwurf.label : zoneTypLabel(entwurf.typ)}
      akzentFarbe={zoneStil(entwurf.typ, entwurf.farbe).lineColor}
      onSchliessen={onSchliessen}
    >
      <Space orientation="vertical" style={{ width: '100%' }}>
        {darfSchreiben ? (
          <Select<ZoneTyp> aria-label="Zonen-Typ" value={entwurf.typ} style={{ width: '100%' }}
            disabled={gesperrt}
            options={erlaubteTypen.map((t) => ({ value: t.typ, label: t.label }))}
            onChange={(typ) => {
              setEntwurf((alt) => ({ ...alt, typ }));
              void speichern({ typ });
            }} />
        ) : (
          <Typography.Text>{zoneTypLabel(zone.typ)}</Typography.Text>
        )}

        {/* Warnstufe und Zonen-Anzahl sind keine Geo-Kennzahlen, gehören aber ins selbe
            Label→Wert-Raster — dafür ist der `zusatz`-Slot da (LFH-328/A2). Die Warnstufe
            ist ein Tag und läuft deshalb mit `zahl={false}` an der Zahlenschrift vorbei.

            Die Bedingung steht HIER und nicht nur in `GeoKennzahlen`: antds `Space` filtert
            ein `false`-Kind heraus, wickelt aber eine Komponente, die null RENDERT, trotzdem
            in ein `.ant-space-item` (gemessen: 3 statt 2) — das gäbe im häufigen Fall ohne
            Kennzahlen eine leere Lücke. Gepinnt im Test. */}
        {(kennzahlen || zusatzZeilen) && (
          <GeoKennzahlen kennzahlen={kennzahlen} zusatz={zusatzZeilen} />
        )}

        <Input aria-label="Label" placeholder="Bezeichnung" value={entwurf.label} disabled={gesperrt}
          onChange={(e) => setEntwurf((alt) => ({ ...alt, label: e.target.value }))}
          onBlur={() => {
            const label = entwurf.label.trim();
            setEntwurf((alt) => ({ ...alt, label }));
            if (label !== (zone.label ?? '')) void speichern({ label: label || null });
          }} />

        {istFreieSkizze && (
          <Input aria-label="Farbe" type="color" value={entwurf.farbe} disabled={gesperrt}
            onChange={(e) => setEntwurf((alt) => ({ ...alt, farbe: e.target.value }))}
            onBlur={() => {
              if (entwurf.farbe !== (zone.farbe ?? '#1677ff')) void speichern({ farbe: entwurf.farbe });
            }} />
        )}

        {entwurf.typ === 'gefahrengebiet' && (
          <>
            {/* Kein `aria-label` mehr: das FeldLabel trägt den Namen (LFH-328/A2). */}
            <FeldLabel text="Gehört zu Gefahrengebiet" htmlFor={gebietId}>
              <Select<number>
                id={gebietId}
                style={{ width: '100%' }}
                value={entwurf.gefahrengebiet_id ?? undefined}
                disabled={gesperrt}
                options={[
                  ...gebiete.map((g) => ({ value: g.id, label: gefahrengebietName(g.label, g.id) })),
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

        <Input.TextArea aria-label="Notiz" placeholder="Notiz" value={entwurf.notiz} disabled={gesperrt} rows={2}
          onChange={(e) => setEntwurf((alt) => ({ ...alt, notiz: e.target.value }))}
          onBlur={() => {
            const notiz = entwurf.notiz.trim();
            setEntwurf((alt) => ({ ...alt, notiz }));
            if (notiz !== (zone.notiz ?? '')) void speichern({ notiz: notiz || null });
          }} />

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
          <Typography.Text type={speicherStatus === 'fehler' ? 'danger' : 'secondary'} aria-live="polite">
            {speicherStatus === 'speichert'
              ? 'speichert …'
              : speicherStatus === 'gespeichert' ? 'gespeichert' : 'nicht gespeichert'}
          </Typography.Text>
        )}

        {darfSchreiben && (
          aktuellHatWarnstufen ? (
            <Popconfirm title="Zone aufheben?" description="Wird das Gefahrengebiet dadurch leer, geht seine Matrix verloren." okText="Aufheben" cancelText="Abbrechen" onConfirm={onLoeschen}>
              <Button danger>Zone aufheben</Button>
            </Popconfirm>
          ) : (
            <Button danger onClick={onLoeschen}>Zone aufheben</Button>
          )
        )}
      </Space>
    </KartenDetailCard>
  );
}
