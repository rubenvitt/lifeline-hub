import { Button, Input, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Gefahrengebiet, LageZone, ZoneTyp } from '../../api/types';
import { gefahrengebietName } from '../../api/gefahren';
import { ZONE_TYPEN, zoneTypLabel, zoneStil } from './zonenStil';
import { WARNSTUFEN, warnstufeFarbe } from '../gefahren/gefahrenSchema';
import { parseGeometry, geoKennzahlen, formatFlaeche, formatLaenge } from './geo';
import KartenDetailCard from './KartenDetailCard';

/** Sentinel im Dropdown für „in neues Gefahrengebiet abspalten". */
const NEU = -1;

/** Read-only Label→Wert-Zeile für die Geometrie-Kennzahlen. */
function KennzahlZeile({ label, wert }: { label: string; wert: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text>{wert}</Typography.Text>
    </div>
  );
}

export interface ZonenInspectorProps {
  zone: LageZone;
  gebiete: Gefahrengebiet[];
  darfSchreiben: boolean;
  onSchliessen: () => void;
  /** Partielles PATCH (nur geänderte Felder). */
  onAendern: (patch: { typ?: ZoneTyp; label?: string | null; farbe?: string | null; notiz?: string | null; gefahrengebiet_id?: number | null }) => void;
  onMatrixOeffnen: (gefahrengebietId: number) => void;
  onLoeschen: () => void;
}

export default function ZonenInspector({ zone, gebiete, darfSchreiben, onSchliessen, onAendern, onMatrixOeffnen, onLoeschen }: ZonenInspectorProps) {
  const istFreieSkizze = zone.typ === 'freie_skizze';
  const erlaubteTypen = ZONE_TYPEN.filter((t) => t.geometrie === 'beides' || t.geometrie === zone.geometrie_typ);
  const aktuellesGebiet = gebiete.find((g) => g.id === zone.gefahrengebiet_id) ?? null;
  const aktuellHatWarnstufen = (aktuellesGebiet?.hoechste_warnstufe ?? 'keine') !== 'keine';
  // Geometrie-Kennzahlen rein clientseitig aus der GeoJSON-Geometrie (LFH-146).
  const kennzahlen = geoKennzahlen(parseGeometry(zone.geometrie));
  const warnstufeLabel = WARNSTUFEN.find((w) => w.wert === aktuellesGebiet?.hoechste_warnstufe)?.label;

  const umhaengen = (ziel: number) => onAendern({ gefahrengebiet_id: ziel === NEU ? null : ziel });

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

        {(kennzahlen || (zone.typ === 'gefahrengebiet' && aktuellesGebiet)) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {kennzahlen?.flaecheM2 != null && (
              <KennzahlZeile label="Fläche" wert={formatFlaeche(kennzahlen.flaecheM2)} />
            )}
            {kennzahlen?.umfangM != null && (
              <KennzahlZeile label="Umfang" wert={formatLaenge(kennzahlen.umfangM)} />
            )}
            {kennzahlen?.laengeM != null && (
              <KennzahlZeile label="Länge" wert={formatLaenge(kennzahlen.laengeM)} />
            )}
            {zone.typ === 'gefahrengebiet' && aktuellesGebiet && (
              <>
                {aktuellHatWarnstufen && (
                  <KennzahlZeile
                    label="Höchste Warnstufe"
                    wert={
                      <Tag
                        color={warnstufeFarbe(aktuellesGebiet.hoechste_warnstufe)}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {warnstufeLabel ?? aktuellesGebiet.hoechste_warnstufe}
                      </Tag>
                    }
                  />
                )}
                <KennzahlZeile label="Zonen" wert={String(aktuellesGebiet.zonen_ids.length)} />
              </>
            )}
          </div>
        )}

        <Input aria-label="Label" placeholder="Bezeichnung" defaultValue={zone.label ?? ''} disabled={!darfSchreiben}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (zone.label ?? '')) onAendern({ label: v || null }); }} />

        {istFreieSkizze && (
          <Input aria-label="Farbe" type="color" defaultValue={zone.farbe ?? '#1677ff'} disabled={!darfSchreiben}
            onBlur={(e) => { const v = e.target.value; if (v !== (zone.farbe ?? '#1677ff')) onAendern({ farbe: v }); }} />
        )}

        {zone.typ === 'gefahrengebiet' && (
          <>
            <Typography.Text type="secondary">Gehört zu Gefahrengebiet</Typography.Text>
            <Select<number>
              aria-label="Gehört zu Gefahrengebiet"
              style={{ width: '100%' }}
              value={zone.gefahrengebiet_id ?? undefined}
              disabled={!darfSchreiben}
              options={[
                ...gebiete.map((g) => ({ value: g.id, label: gefahrengebietName(g.label, g.id) })),
                { value: NEU, label: '+ Neues Gefahrengebiet' },
              ]}
              onChange={(v) => umhaengen(v)}
            />
            {zone.gefahrengebiet_id != null && (
              <Button block onClick={() => onMatrixOeffnen(zone.gefahrengebiet_id as number)}>
                Gefahrenmatrix bearbeiten
              </Button>
            )}
          </>
        )}

        <Input.TextArea aria-label="Notiz" placeholder="Notiz" defaultValue={zone.notiz ?? ''} disabled={!darfSchreiben} rows={2}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (zone.notiz ?? '')) onAendern({ notiz: v || null }); }} />

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
