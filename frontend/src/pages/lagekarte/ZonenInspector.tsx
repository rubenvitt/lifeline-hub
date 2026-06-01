import { Button, Card, Input, Select, Space, Typography } from 'antd';
import type { LageZone, ZoneTyp } from '../../api/types';
import { ZONE_TYPEN, zoneTypLabel } from './zonenStil';

export interface ZonenInspectorProps {
  zone: LageZone;
  darfSchreiben: boolean;
  onSchliessen: () => void;
  /** Partielles PATCH (nur geänderte Felder). */
  onAendern: (patch: { typ?: ZoneTyp; label?: string | null; farbe?: string | null; notiz?: string | null }) => void;
  onLoeschen: () => void;
}

/** Inspector für eine Zone: Typ/Label/Notiz/Farbe ändern (PATCH) + löschen (DELETE). */
export default function ZonenInspector({ zone, darfSchreiben, onSchliessen, onAendern, onLoeschen }: ZonenInspectorProps) {
  const istFreieSkizze = zone.typ === 'freie_skizze';
  // Beim Typ-Wechsel sind nur Typen mit passender Geometrie zulässig (Geometrie ist fix).
  const erlaubteTypen = ZONE_TYPEN.filter(
    (t) => t.geometrie === 'beides' || t.geometrie === zone.geometrie_typ,
  );

  return (
    <Card
      title={zone.label?.trim() ? zone.label : zoneTypLabel(zone.typ)}
      extra={<Button type="text" onClick={onSchliessen} aria-label="Schließen">×</Button>}
      size="small"
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {darfSchreiben ? (
          <Select<ZoneTyp>
            aria-label="Zonen-Typ"
            value={zone.typ}
            style={{ width: '100%' }}
            options={erlaubteTypen.map((t) => ({ value: t.typ, label: t.label }))}
            onChange={(v) => onAendern({ typ: v })}
          />
        ) : (
          <Typography.Text>{zoneTypLabel(zone.typ)}</Typography.Text>
        )}

        <Input
          aria-label="Label"
          placeholder="Bezeichnung"
          defaultValue={zone.label ?? ''}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (zone.label ?? '')) onAendern({ label: v || null });
          }}
        />

        {istFreieSkizze && (
          <Input
            aria-label="Farbe"
            type="color"
            defaultValue={zone.farbe ?? '#1677ff'}
            disabled={!darfSchreiben}
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== (zone.farbe ?? '#1677ff')) onAendern({ farbe: v });
            }}
          />
        )}

        <Input.TextArea
          aria-label="Notiz"
          placeholder="Notiz"
          defaultValue={zone.notiz ?? ''}
          disabled={!darfSchreiben}
          rows={2}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (zone.notiz ?? '')) onAendern({ notiz: v || null });
          }}
        />

        {darfSchreiben && (
          <Button danger onClick={onLoeschen}>
            Zone aufheben
          </Button>
        )}
      </Space>
    </Card>
  );
}
