import { Button, Input, Popconfirm, Space, Typography } from 'antd';
import { Select } from '../../components/Select';
import { useId } from 'react';
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
  onAendern: (patch: { typ?: ZoneTyp; label?: string | null; farbe?: string | null; notiz?: string | null; gefahrengebiet_id?: number | null; ansicht_id?: number | null }) => void;
  onMatrixOeffnen: (gefahrengebietId: number) => void;
  onLoeschen: () => void;
  /** Ansichts-Zuordnung (B/LFH-320). */
  ansichten: KartenAnsicht[];
}

export default function ZonenInspector({ zone, gebiete, darfSchreiben, onSchliessen, onAendern, onMatrixOeffnen, onLoeschen, ansichten }: ZonenInspectorProps) {
  const gebietId = useId();
  const istFreieSkizze = zone.typ === 'freie_skizze';
  const erlaubteTypen = ZONE_TYPEN.filter((t) => t.geometrie === 'beides' || t.geometrie === zone.geometrie_typ);
  const aktuellesGebiet = gebiete.find((g) => g.id === zone.gefahrengebiet_id) ?? null;
  const aktuellHatWarnstufen = (aktuellesGebiet?.hoechste_warnstufe ?? 'keine') !== 'keine';
  // Geometrie-Kennzahlen rein clientseitig aus der GeoJSON-Geometrie (LFH-146).
  const kennzahlen = geoKennzahlen(parseGeometry(zone.geometrie));

  const umhaengen = (ziel: number) => onAendern({ gefahrengebiet_id: ziel === NEU ? null : ziel });

  // Nicht-Geo-Zeilen im selben Raster (Warnstufe, Zonen-Anzahl) — null, wenn keine anfallen.
  const zusatzZeilen =
    zone.typ === 'gefahrengebiet' && aktuellesGebiet ? (
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
      titel={zone.label?.trim() ? zone.label : zoneTypLabel(zone.typ)}
      akzentFarbe={zoneStil(zone.typ, zone.farbe).lineColor}
      onSchliessen={onSchliessen}
    >
      <Space orientation="vertical" style={{ width: '100%' }}>
        {darfSchreiben ? (
          <Select<ZoneTyp> aria-label="Zonen-Typ" value={zone.typ} style={{ width: '100%' }}
            options={erlaubteTypen.map((t) => ({ value: t.typ, label: t.label }))}
            onChange={(v) => onAendern({ typ: v })} />
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

        <Input aria-label="Label" placeholder="Bezeichnung" defaultValue={zone.label ?? ''} disabled={!darfSchreiben}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (zone.label ?? '')) onAendern({ label: v || null }); }} />

        {istFreieSkizze && (
          <Input aria-label="Farbe" type="color" defaultValue={zone.farbe ?? '#1677ff'} disabled={!darfSchreiben}
            onBlur={(e) => { const v = e.target.value; if (v !== (zone.farbe ?? '#1677ff')) onAendern({ farbe: v }); }} />
        )}

        {zone.typ === 'gefahrengebiet' && (
          <>
            {/* Kein `aria-label` mehr: das FeldLabel trägt den Namen (LFH-328/A2). */}
            <FeldLabel text="Gehört zu Gefahrengebiet" htmlFor={gebietId}>
              <Select<number>
                id={gebietId}
                style={{ width: '100%' }}
                value={zone.gefahrengebiet_id ?? undefined}
                disabled={!darfSchreiben}
                options={[
                  ...gebiete.map((g) => ({ value: g.id, label: gefahrengebietName(g.label, g.id) })),
                  { value: NEU, label: '+ Neues Gefahrengebiet' },
                ]}
                onChange={(v) => umhaengen(v)}
              />
            </FeldLabel>
            {zone.gefahrengebiet_id != null && (
              <Button block onClick={() => onMatrixOeffnen(zone.gefahrengebiet_id as number)}>
                Gefahrenmatrix bearbeiten
              </Button>
            )}
          </>
        )}

        <Input.TextArea aria-label="Notiz" placeholder="Notiz" defaultValue={zone.notiz ?? ''} disabled={!darfSchreiben} rows={2}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (zone.notiz ?? '')) onAendern({ notiz: v || null }); }} />

        <AnsichtZuordnung
          ansichten={ansichten}
          wert={zone.ansicht_id}
          disabled={!darfSchreiben}
          onChange={(ansichtId) => onAendern({ ansicht_id: ansichtId })}
        />

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
