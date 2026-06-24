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

  const setCenter = (wert: LatLon | null) => {
    if (!wert) return;
    onChange(eckenAusRechteck({ ...r, center: [wert.lon, wert.lat] }));
  };
  const setRotation = (grad: number) => onChange(eckenAusRechteck({ ...r, rotationGrad: grad }));
  const setBreite = (faktor: number) =>
    onChange(eckenAusRechteck({ ...r, breiteGrad: r.breiteGrad * faktor, hoeheGrad: r.hoeheGrad * faktor }));

  return (
    <Card size="small" title="Bild platzieren">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Bild auf der Karte verschieben/skalieren (Ziehgriffe) oder Mittelpunkt numerisch setzen.
        </Typography.Text>
        <Typography.Text>Mittelpunkt</Typography.Text>
        <KoordinatenEingabe value={center} onChange={setCenter} einsatzId={einsatzId} />
        <Typography.Text>Drehung</Typography.Text>
        <Slider min={-180} max={180} value={Math.round(r.rotationGrad)}
          onChange={(v) => setRotation(v as number)} tooltip={{ formatter: (v) => `${v}°` }} />
        <Typography.Text>Größe</Typography.Text>
        <Slider min={50} max={200} defaultValue={100}
          onChange={(v) => setBreite((v as number) / 100)} tooltip={{ formatter: (v) => `${v}%` }} />
        <Button type="primary" block onClick={onFertig}>Platzierung übernehmen</Button>
      </Space>
    </Card>
  );
}
