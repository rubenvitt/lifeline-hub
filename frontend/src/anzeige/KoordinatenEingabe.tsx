import { Input, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { Koordinatenformat } from '../api/types';
import { formatiere, parse, type LatLon } from './koordinaten';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { setzeOverride, useKoordinatenSystemOverride } from './koordinatenSystemStore';

const OPTIONEN: { value: Koordinatenformat; label: string }[] = [
  { value: 'wgs84', label: 'WGS84 dezimal' },
  { value: 'dms', label: 'Grad/Min/Sek' },
  { value: 'utm', label: 'UTM' },
  { value: 'mgrs', label: 'MGRS' },
  { value: 'gk', label: 'Gauß-Krüger' },
];

interface Props {
  value?: LatLon | null;
  onChange?: (wert: LatLon | null) => void;
  status?: 'error' | 'warning';
}

export default function KoordinatenEingabe({ value, onChange, status }: Props) {
  const override = useKoordinatenSystemOverride();
  const { konventionen } = useAnzeigeKonventionen();
  const system: Koordinatenformat = override ?? konventionen.koordinatenformat ?? 'wgs84';

  const [text, setText] = useState('');
  const [fehler, setFehler] = useState(false);
  const [fokus, setFokus] = useState(false);

  // Aus der Wahrheit reformatieren bei EXTERNER Änderung (Laden, Kartenklick, Systemwechsel).
  // NICHT während aktivem Tippen — sonst überschreibt der Effekt die laufende Eingabe und der
  // Cursor springt (das passiert nur in der Form, wo onChange→value zurückgespeist wird).
  useEffect(() => {
    if (fokus) return;
    setText(value ? formatiere(value.lat, value.lon, system) : '');
    setFehler(false);
  }, [value, system, fokus]);

  function bearbeiten(roh: string) {
    setText(roh);
    if (roh.trim() === '') {
      setFehler(false);
      onChange?.(null);
      return;
    }
    try {
      onChange?.(parse(roh, system));
      setFehler(false);
    } catch {
      setFehler(true);
      onChange?.(null);
    }
  }

  return (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={text}
          onChange={(e) => bearbeiten(e.target.value)}
          onFocus={() => setFokus(true)}
          onBlur={() => setFokus(false)}
          status={fehler || status === 'error' ? 'error' : undefined}
          placeholder="Koordinate eingeben"
        />
        <Select<Koordinatenformat>
          value={system}
          onChange={setzeOverride}
          options={OPTIONEN}
          style={{ width: 150 }}
        />
      </Space.Compact>
      {fehler ? (
        <Typography.Text type="danger">Ungültige {system}-Koordinate</Typography.Text>
      ) : value ? (
        <Typography.Text type="secondary">
          entspricht {formatiere(value.lat, value.lon, 'wgs84')}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
