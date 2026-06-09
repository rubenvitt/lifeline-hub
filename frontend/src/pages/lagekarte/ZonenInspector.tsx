import { Button, Card, Input, Popconfirm, Select, Space, Typography } from 'antd';
import type { Gefahrengebiet, LageZone, ZoneTyp } from '../../api/types';
import { gefahrengebietName } from '../../api/gefahren';
import { ZONE_TYPEN, zoneTypLabel } from './zonenStil';

/** Sentinel im Dropdown für „in neues Gefahrengebiet abspalten". */
const NEU = -1;

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

  const umhaengen = (ziel: number) => onAendern({ gefahrengebiet_id: ziel === NEU ? null : ziel });

  return (
    <Card
      title={zone.label?.trim() ? zone.label : zoneTypLabel(zone.typ)}
      extra={<Button type="text" onClick={onSchliessen} aria-label="Schließen">×</Button>}
      size="small"
      style={{ position: 'absolute', right: 12, top: 12, width: 280, maxHeight: 'calc(100% - 24px)', overflowY: 'auto', zIndex: 5 }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {darfSchreiben ? (
          <Select<ZoneTyp> aria-label="Zonen-Typ" value={zone.typ} style={{ width: '100%' }}
            options={erlaubteTypen.map((t) => ({ value: t.typ, label: t.label }))}
            onChange={(v) => onAendern({ typ: v })} />
        ) : (
          <Typography.Text>{zoneTypLabel(zone.typ)}</Typography.Text>
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
    </Card>
  );
}
