import { Badge, Button, Card, Empty, List, Radio, Space, Switch, Tooltip, Typography } from 'antd';
import type { KarteMarker, NichtVerortet } from './marker';
import type { BasemapModus } from './basemapStil';

export interface LayerSichtbar {
  einsatzort: boolean;
  uhs: boolean;
  schaden: boolean;
}

export interface SidebarProps {
  nichtVerortet: NichtVerortet[];
  verortet: KarteMarker[];
  darfSchreiben: boolean;
  platzierungZiel: { typ: 'uhs' | 'schaden' | 'einsatzort'; id: number } | null;
  onPlatzierenStart: (ziel: { typ: 'uhs' | 'schaden'; id: number }) => void;
  onPlatzierenAbbrechen: () => void;
  einsatzortVerortet: boolean;
  onEinsatzortPlatzieren: () => void;
  layer: LayerSichtbar;
  onLayerToggle: (key: keyof LayerSichtbar, an: boolean) => void;
  basemap: BasemapModus;
  onBasemapWechsel: (modus: BasemapModus) => void;
  onMarkerWaehlen: (schluessel: string) => void;
  onlineVerfuegbar: boolean;
  offlineVerfuegbar: boolean;
}

export default function Sidebar(props: SidebarProps) {
  const { nichtVerortet, verortet, darfSchreiben, platzierungZiel } = props;
  const uhsVerortet = verortet.filter((m) => m.typ === 'uhs');
  const schadenVerortet = verortet.filter((m) => m.typ === 'schaden');

  return (
    <div style={{ width: 300, padding: 12, overflowY: 'auto', height: '100%' }}>
      <Card
        size="small"
        title={
          <Space>
            <Typography.Text strong>⚠ Nicht verortet</Typography.Text>
            <Badge count={nichtVerortet.length} showZero color="#fa8c16" />
          </Space>
        }
        style={{ marginBottom: 12 }}
      >
        {nichtVerortet.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Alles verortet" />
        ) : (
          <List
            size="small"
            dataSource={nichtVerortet}
            renderItem={(o) => {
              const aktiv = platzierungZiel?.typ === o.typ && platzierungZiel?.id === o.id;
              return (
                <List.Item
                  key={`${o.typ}-${o.id}`}
                  actions={
                    darfSchreiben
                      ? [
                          aktiv ? (
                            <Button size="small" onClick={props.onPlatzierenAbbrechen}>
                              Abbrechen
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              type="primary"
                              onClick={() =>
                                props.onPlatzierenStart({ typ: o.typ as 'uhs' | 'schaden', id: o.id })
                              }
                            >
                              Platzieren
                            </Button>
                          ),
                        ]
                      : []
                  }
                >
                  <Typography.Text>
                    {o.typ === 'uhs' ? 'UHS' : 'Schaden'}: {o.label}
                  </Typography.Text>
                </List.Item>
              );
            }}
          />
        )}
      </Card>

      {platzierungZiel && darfSchreiben && (
        <Card size="small" style={{ marginBottom: 12, borderColor: '#1677ff' }}>
          <Typography.Text type="secondary">
            Klick auf die Karte setzt die Koordinate. (Abbrechen beendet.)
          </Typography.Text>
        </Card>
      )}

      <Card size="small" title="Einsatzort" style={{ marginBottom: 12 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Text type={props.einsatzortVerortet ? undefined : 'warning'}>
            {props.einsatzortVerortet ? 'verortet' : 'nicht verortet'}
          </Typography.Text>
          {darfSchreiben &&
            (platzierungZiel?.typ === 'einsatzort' ? (
              <Button size="small" onClick={props.onPlatzierenAbbrechen}>
                Abbrechen
              </Button>
            ) : (
              <Button
                size="small"
                type={props.einsatzortVerortet ? 'default' : 'primary'}
                onClick={props.onEinsatzortPlatzieren}
              >
                {props.einsatzortVerortet ? 'Verschieben' : 'Platzieren'}
              </Button>
            ))}
        </Space>
      </Card>

      <Card size="small" title="Verortet" style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">UHS ({uhsVerortet.length})</Typography.Text>
        <List
          size="small"
          dataSource={uhsVerortet}
          renderItem={(m) => (
            <List.Item key={m.schluessel} style={{ cursor: 'pointer' }} onClick={() => props.onMarkerWaehlen(m.schluessel)}>
              {m.label}
            </List.Item>
          )}
        />
        <Typography.Text type="secondary">Schäden ({schadenVerortet.length})</Typography.Text>
        <List
          size="small"
          dataSource={schadenVerortet}
          renderItem={(m) => (
            <List.Item key={m.schluessel} style={{ cursor: 'pointer' }} onClick={() => props.onMarkerWaehlen(m.schluessel)}>
              {m.label}
            </List.Item>
          )}
        />
      </Card>

      <Card size="small" title="Ebenen" style={{ marginBottom: 12 }}>
        <Space direction="vertical">
          <Space>
            <Switch checked={props.layer.einsatzort} onChange={(v) => props.onLayerToggle('einsatzort', v)} />
            Einsatzort
          </Space>
          <Space>
            <Switch checked={props.layer.uhs} onChange={(v) => props.onLayerToggle('uhs', v)} /> UHS
          </Space>
          <Space>
            <Switch checked={props.layer.schaden} onChange={(v) => props.onLayerToggle('schaden', v)} /> Schäden
          </Space>
        </Space>
      </Card>

      <Card size="small" title="Basemap">
        <Radio.Group
          value={props.basemap}
          onChange={(e) => props.onBasemapWechsel(e.target.value as BasemapModus)}
          optionType="button"
          size="small"
        >
          <Tooltip title={props.onlineVerfuegbar ? '' : 'nicht konfiguriert'}>
            <Radio.Button value="online" disabled={!props.onlineVerfuegbar}>
              Online
            </Radio.Button>
          </Tooltip>
          <Tooltip title={props.offlineVerfuegbar ? '' : 'nicht konfiguriert'}>
            <Radio.Button value="offline" disabled={!props.offlineVerfuegbar}>
              Offline
            </Radio.Button>
          </Tooltip>
          <Radio.Button value="blind">Blind</Radio.Button>
        </Radio.Group>
        {props.basemap === 'blind' && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            Keine Basemap konfiguriert — Marker und Verorten funktionieren weiterhin.
          </Typography.Paragraph>
        )}
      </Card>
    </div>
  );
}
