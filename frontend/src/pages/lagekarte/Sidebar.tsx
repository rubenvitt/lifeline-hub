import { Badge, Button, Card, Empty, InputNumber, List, Radio, Select, Space, Switch, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import type { KarteMarker, NichtVerortet } from './marker';
import type { BasemapModus } from './basemapStil';
import type { OnlineStyle } from '../../api/karte';

export interface LayerSichtbar {
  einsatzort: boolean;
  uhs: boolean;
  schaden: boolean;
  einheit: boolean;
  fahrzeug: boolean;
  fuehrung: boolean;
  abschnitt: boolean;
}

/** Platzierbare Punkt-Typen (Fläche/Abschnitt läuft über onAbschnittZeichnenStart). */
export type PlatzierenPunktTyp = 'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung';

const NICHT_VERORTET_LABEL: Record<NichtVerortet['typ'], string> = {
  uhs: 'UHS',
  schaden: 'Schaden',
  einheit: 'Einheit',
  fahrzeug: 'Fahrzeug',
  fuehrung: 'Führung',
  abschnitt: 'Abschnitt',
};

export interface SidebarProps {
  nichtVerortet: NichtVerortet[];
  verortet: KarteMarker[];
  darfSchreiben: boolean;
  platzierungZiel: { typ: PlatzierenPunktTyp | 'einsatzort'; id: number } | null;
  onPlatzierenStart: (ziel: { typ: PlatzierenPunktTyp; id: number }) => void;
  onPlatzierenAbbrechen: () => void;
  onAbschnittZeichnenStart: (id: number) => void;
  onKoordinateEingeben: (lat: number, lon: number) => void;
  einsatzortVerortet: boolean;
  onEinsatzortPlatzieren: () => void;
  layer: LayerSichtbar;
  onLayerToggle: (key: keyof LayerSichtbar, an: boolean) => void;
  basemap: BasemapModus;
  onBasemapWechsel: (modus: BasemapModus) => void;
  onMarkerWaehlen: (schluessel: string) => void;
  onlineVerfuegbar: boolean;
  offlineVerfuegbar: boolean;
  onlineStyles: OnlineStyle[];
  onlineStilName: string | null;
  onOnlineStilWechsel: (name: string) => void;
}

export default function Sidebar(props: SidebarProps) {
  const { nichtVerortet, verortet, darfSchreiben, platzierungZiel } = props;
  const [manuellLat, setManuellLat] = useState<number | null>(null);
  const [manuellLon, setManuellLon] = useState<number | null>(null);
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
              let action: React.ReactNode = null;
              if (darfSchreiben) {
                if (o.typ === 'abschnitt') {
                  action = (
                    <Button size="small" type="primary" onClick={() => props.onAbschnittZeichnenStart(o.id)}>
                      Fläche zeichnen
                    </Button>
                  );
                } else if (aktiv) {
                  action = (
                    <Button size="small" onClick={props.onPlatzierenAbbrechen}>
                      Abbrechen
                    </Button>
                  );
                } else {
                  // o.typ ist hier auf die Punkt-Typen verengt (abschnitt oben behandelt).
                  const punktTyp = o.typ;
                  action = (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => props.onPlatzierenStart({ typ: punktTyp, id: o.id })}
                    >
                      Platzieren
                    </Button>
                  );
                }
              }
              return (
                <List.Item key={`${o.typ}-${o.id}`} actions={action ? [action] : []}>
                  <Typography.Text>
                    {NICHT_VERORTET_LABEL[o.typ]}: {o.label}
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
          <Space style={{ marginTop: 8 }} wrap>
            <InputNumber
              size="small"
              placeholder="Lat"
              aria-label="Breitengrad"
              value={manuellLat}
              onChange={(v) => setManuellLat(v)}
              style={{ width: 90 }}
            />
            <InputNumber
              size="small"
              placeholder="Lon"
              aria-label="Längengrad"
              value={manuellLon}
              onChange={(v) => setManuellLon(v)}
              style={{ width: 90 }}
            />
            <Button
              size="small"
              disabled={manuellLat == null || manuellLon == null}
              onClick={() => {
                if (manuellLat != null && manuellLon != null) props.onKoordinateEingeben(manuellLat, manuellLon);
              }}
            >
              Übernehmen
            </Button>
          </Space>
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
          <Space>
            <Switch checked={props.layer.einheit} onChange={(v) => props.onLayerToggle('einheit', v)} /> Einheiten
          </Space>
          <Space>
            <Switch checked={props.layer.fahrzeug} onChange={(v) => props.onLayerToggle('fahrzeug', v)} /> Fahrzeuge
          </Space>
          <Space>
            <Switch checked={props.layer.fuehrung} onChange={(v) => props.onLayerToggle('fuehrung', v)} /> Personal-Führung
          </Space>
          <Space>
            <Switch checked={props.layer.abschnitt} onChange={(v) => props.onLayerToggle('abschnitt', v)} /> Abschnitte
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
        {props.basemap === 'online' && props.onlineStyles.length > 1 && (
          <Select
            size="small"
            aria-label="Online-Ansicht"
            style={{ width: '100%', marginTop: 8 }}
            value={props.onlineStilName ?? props.onlineStyles[0]?.name}
            onChange={(name) => props.onOnlineStilWechsel(name)}
            options={props.onlineStyles.map((s) => ({ label: s.name, value: s.name }))}
          />
        )}
        {props.basemap === 'blind' && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            Keine Basemap konfiguriert — Marker und Verorten funktionieren weiterhin.
          </Typography.Paragraph>
        )}
      </Card>
    </div>
  );
}
