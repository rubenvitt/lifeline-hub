import { useEffect, useState } from 'react';
import { Button, Card, Input, Select, Space, Typography } from 'antd';
import type { Gefahrentyp, LageZone, Schutzobjekt, ZoneTyp } from '../../api/types';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, kombinationGueltig } from '../gefahren/gefahrenSchema';
import { ZONE_TYPEN, zoneTypLabel } from './zonenStil';

export interface ZonenInspectorProps {
  zone: LageZone;
  darfSchreiben: boolean;
  onSchliessen: () => void;
  /** Partielles PATCH (nur geänderte Felder). */
  onAendern: (patch: {
    typ?: ZoneTyp;
    label?: string | null;
    farbe?: string | null;
    notiz?: string | null;
    gefahrentyp?: Gefahrentyp | null;
    schutzobjekt?: Schutzobjekt | null;
  }) => void;
  onLoeschen: () => void;
}

/** Inspector für eine Zone: Typ/Label/Notiz/Farbe ändern (PATCH) + löschen (DELETE). */
export default function ZonenInspector({ zone, darfSchreiben, onSchliessen, onAendern, onLoeschen }: ZonenInspectorProps) {
  const istFreieSkizze = zone.typ === 'freie_skizze';
  // Beim Typ-Wechsel sind nur Typen mit passender Geometrie zulässig (Geometrie ist fix).
  const erlaubteTypen = ZONE_TYPEN.filter(
    (t) => t.geometrie === 'beides' || t.geometrie === zone.geometrie_typ,
  );

  // Lokaler Entwurf für die Gefahren-Zuordnung: solange noch kein Schutzobjekt
  // gespeichert ist, darf NICHT einzeln gePATCHt werden (Backend: beide-oder-keine).
  // Erst wenn das Paar vollständig ist, wird genau ein PATCH mit BEIDEN Feldern gesendet.
  const [entwurfGefahrentyp, setEntwurfGefahrentyp] = useState<Gefahrentyp | null>(zone.gefahrentyp);
  useEffect(() => { setEntwurfGefahrentyp(zone.gefahrentyp); }, [zone.id, zone.gefahrentyp]);
  const aktuellerGefahrentyp = zone.gefahrentyp ?? entwurfGefahrentyp;

  return (
    <Card
      title={zone.label?.trim() ? zone.label : zoneTypLabel(zone.typ)}
      extra={<Button type="text" onClick={onSchliessen} aria-label="Schließen">×</Button>}
      size="small"
      style={{ position: 'absolute', right: 12, top: 12, width: 280, maxHeight: 'calc(100% - 24px)', overflowY: 'auto', zIndex: 5 }}
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

        {zone.typ === 'gefahrengebiet' && (
          <>
            <Select<Gefahrentyp>
              aria-label="Gefahrentyp"
              allowClear
              placeholder="Gefahrentyp"
              style={{ width: '100%' }}
              value={aktuellerGefahrentyp ?? undefined}
              disabled={!darfSchreiben}
              options={GEFAHRENTYPEN.map((g) => ({
                value: g.wert,
                label: g.label,
                // Gegen das gespeicherte Schutzobjekt symmetrisch sperren (vermeidet 422-Toast).
                disabled: zone.schutzobjekt ? !kombinationGueltig(g.wert, zone.schutzobjekt) : false,
              }))}
              onChange={(v) => {
                // Beim Leeren beide Felder nullen (beide-oder-keine).
                if (!v) {
                  setEntwurfGefahrentyp(null);
                  onAendern({ gefahrentyp: null, schutzobjekt: null });
                } else {
                  setEntwurfGefahrentyp(v);
                  // Bestehendes Paar: einzelnes Feld ist ok (das andere ist im Backend gesetzt).
                  // Ohne gespeichertes schutzobjekt nur Entwurf halten, kein PATCH.
                  if (zone.schutzobjekt) onAendern({ gefahrentyp: v, schutzobjekt: zone.schutzobjekt });
                }
              }}
            />
            <Select<Schutzobjekt>
              aria-label="Schutzobjekt"
              allowClear
              placeholder="Schutzobjekt"
              style={{ width: '100%' }}
              value={zone.schutzobjekt ?? undefined}
              disabled={!darfSchreiben || !aktuellerGefahrentyp}
              options={SCHUTZOBJEKTE.map((o) => ({
                value: o.wert,
                label: o.label,
                disabled: aktuellerGefahrentyp ? !kombinationGueltig(aktuellerGefahrentyp, o.wert) : true,
              }))}
              onChange={(v) => {
                if (!v) {
                  onAendern({ gefahrentyp: null, schutzobjekt: null });
                  setEntwurfGefahrentyp(null);
                } else if (aktuellerGefahrentyp) {
                  // Genau ein PATCH mit BEIDEN Feldern → etabliert die Zuordnung atomar.
                  onAendern({ gefahrentyp: aktuellerGefahrentyp, schutzobjekt: v });
                }
              }}
            />
          </>
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
