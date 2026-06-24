import { useState, useEffect } from 'react';
import { Card, Space, Slider, Typography, Button } from 'antd';
import KoordinatenEingabe from '../../anzeige/KoordinatenEingabe';
import type { LatLon } from '../../anzeige/koordinaten';
import type { Ecken } from '../../api/kartenbilder';
import { eckenAusRechteck, rechteckAusEcken } from './bildGeometrie';

interface Props {
  einsatzId: number;
  ecken: Ecken;
  onChange: (ecken: Ecken) => void;
  onFertig: () => void;
}

export default function BildPlatzierenPanel({ einsatzId, ecken, onChange, onFertig }: Props) {
  const r = rechteckAusEcken(ecken);
  const center: LatLon = { lat: r.center[1], lon: r.center[0] };

  // Lokaler State für Größe-Slider (Prozentwert, relativ zur aktuellen Größe).
  // Wird bei Bildwechsel auf 100 zurückgesetzt, damit der Slider pro Bild neu startet.
  const [groesseProzent, setGroesseProzent] = useState(100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setGroesseProzent(100); }, [ecken]);

  const setCenter = (wert: LatLon | null) => {
    if (!wert) return;
    onChange(eckenAusRechteck({ ...r, center: [wert.lon, wert.lat] }));
  };

  return (
    <Card size="small" title="Bild platzieren">
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Bild auf der Karte verschieben/skalieren (Ziehgriffe) oder Mittelpunkt numerisch setzen.
        </Typography.Text>
        <Typography.Text>Mittelpunkt</Typography.Text>
        <KoordinatenEingabe value={center} onChange={setCenter} einsatzId={einsatzId} />
        <Typography.Text>Drehung</Typography.Text>
        <Slider
          min={-180}
          max={180}
          value={Math.round(r.rotationGrad)}
          onChange={() => {
            // Kein PATCH bei jedem Tick — Live-Vorschau würde hier sinnlos sein,
            // da keine direkte MapLibre-API für Rotation ohne PATCH existiert.
            // Die Live-Vorschau erfolgt über die Karte (bildLayer) nach dem PATCH.
          }}
          onChangeComplete={(v) => onChange(eckenAusRechteck({ ...r, rotationGrad: v as number }))}
          tooltip={{ formatter: (v) => `${v}°` }}
        />
        <Typography.Text>Größe</Typography.Text>
        <Slider
          min={50}
          max={200}
          value={groesseProzent}
          onChange={(v) => setGroesseProzent(v as number)}
          onChangeComplete={(v) =>
            onChange(eckenAusRechteck({
              ...r,
              breiteGrad: r.breiteGrad * ((v as number) / 100),
              hoeheGrad: r.hoeheGrad * ((v as number) / 100),
            }))
          }
          tooltip={{ formatter: (v) => `${v}%` }}
        />
        <Button type="primary" block onClick={onFertig}>Platzierung übernehmen</Button>
      </Space>
    </Card>
  );
}
