import { Badge, Button, Card, Empty, List, Radio, Select, Space, Spin, Switch, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import type { KarteMarker, NichtVerortet } from './marker';
import type { BasemapModus } from './basemapStil';
import type { OnlineStyle } from '../../api/karte';
import type { ZoneTyp } from '../../api/types';
import type { ZeichenModus } from './zeichnen';
import { ZONE_TYPEN } from './zonenStil';
import { FACHEBENEN, fachebeneKeys } from './fachebenen';
import KoordinatenEingabe from '../../anzeige/KoordinatenEingabe';
import type { LatLon } from '../../anzeige/koordinaten';

export interface LayerSichtbar {
  einsatzort: boolean;
  uhs: boolean;
  schaden: boolean;
  einheit: boolean;
  fahrzeug: boolean;
  fuehrung: boolean;
  abschnitt: boolean;
  zone: boolean;
  lagemeldung: boolean;
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
  onZoneZeichnenStart: (entwurf: { typ: ZoneTyp; modus: ZeichenModus; farbe?: string }) => void;
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
  fachebenenSichtbar: import('./fachebenenAuswahl').FachebenenSichtbar;
  onFachebeneToggle: (key: import('../../api/fachebenen').FachebeneQuelle, an: boolean) => void;
  /** Status je Fachebene für Ausgrau-/Offline-Hinweis. */
  fachebenenStatus: Partial<Record<import('../../api/fachebenen').FachebeneQuelle, import('../../api/fachebenen').FachebeneStatus>>;
  /** KRITIS ist aktiv, aber die Karte ist zu weit herausgezoomt für eine Abfrage. */
  kritisZoomZuKlein?: boolean;
  /** Lade-Zustand je Fachebene (z. B. KRITIS/Overpass lädt länger → Spinner). */
  fachebenenLaedt?: Partial<Record<import('../../api/fachebenen').FachebeneQuelle, boolean>>;
}

export default function Sidebar(props: SidebarProps) {
  const { nichtVerortet, verortet, darfSchreiben, platzierungZiel } = props;
  const [koord, setKoord] = useState<LatLon | null>(null);
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
          <div style={{ marginTop: 8 }}>
            <KoordinatenEingabe value={koord} onChange={setKoord} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              disabled={!koord}
              onClick={() => {
                if (koord) {
                  props.onKoordinateEingeben(koord.lat, koord.lon);
                  setKoord(null);
                }
              }}
            >
              Übernehmen
            </Button>
          </div>
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
          <Space>
            <Switch checked={props.layer.zone} onChange={(v) => props.onLayerToggle('zone', v)} /> Zonen
          </Space>
          <Space>
            <Switch checked={props.layer.lagemeldung} onChange={(v) => props.onLayerToggle('lagemeldung', v)} /> Lagemeldungen
          </Space>
        </Space>
      </Card>

      <Card size="small" title="Fachebenen (extern)" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {fachebeneKeys().map((key) => {
            const def = FACHEBENEN[key];
            const status = props.fachebenenStatus[key];
            const sichtbar = props.fachebenenSichtbar[key];
            const offline = status === 'offline';
            const laedt = sichtbar && props.fachebenenLaedt?.[key];
            const zoomHinweis = sichtbar && key === 'kritis' && props.kritisZoomZuKlein;
            return (
              <Space key={key} style={{ justifyContent: 'space-between', width: '100%' }}>
                <Space>
                  <Switch
                    checked={sichtbar}
                    onChange={(v) => props.onFachebeneToggle(key, v)}
                  />
                  <span style={{ color: def.farbe }}>●</span> {def.label}
                </Space>
                {laedt ? (
                  <Spin size="small" />
                ) : zoomHinweis ? (
                  <Tooltip title="KRITIS-Objekte werden erst ab einer näheren Zoomstufe geladen">
                    <Typography.Text type="warning" style={{ fontSize: 11 }}>näher heranzoomen</Typography.Text>
                  </Tooltip>
                ) : (
                  <>
                    {sichtbar && offline && (
                      <Tooltip title="Quelle offline — Ebene wird leer angezeigt">
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>offline</Typography.Text>
                      </Tooltip>
                    )}
                    {sichtbar && status === 'leer' && (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>keine Daten</Typography.Text>
                    )}
                  </>
                )}
              </Space>
            );
          })}
        </Space>
      </Card>

      {darfSchreiben && (
        <Card size="small" title="Zone zeichnen" style={{ marginBottom: 12 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {ZONE_TYPEN.map((t) => {
              if (t.geometrie === 'beides') {
                return (
                  <Space key={t.typ}>
                    <Typography.Text>{t.label}</Typography.Text>
                    <Button
                      size="small"
                      onClick={() => props.onZoneZeichnenStart({ typ: t.typ, modus: 'polygon', farbe: '#1677ff' })}
                    >
                      Fläche
                    </Button>
                    <Button
                      size="small"
                      onClick={() => props.onZoneZeichnenStart({ typ: t.typ, modus: 'linie', farbe: '#1677ff' })}
                    >
                      Linie
                    </Button>
                  </Space>
                );
              }
              const modus: ZeichenModus = t.geometrie === 'LineString' ? 'linie' : 'polygon';
              return (
                <Button
                  key={t.typ}
                  size="small"
                  block
                  onClick={() => props.onZoneZeichnenStart({ typ: t.typ, modus })}
                >
                  {t.label} zeichnen
                </Button>
              );
            })}
          </Space>
        </Card>
      )}

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
