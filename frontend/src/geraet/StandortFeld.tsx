import { useState } from 'react';
import { Button, Flex, Typography } from 'antd';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { IconKreuz, IconStandortZiel } from '../icons';
import {
  EIGENPOSITION_SPERRGRUND,
  MELDUNG_KEIN_STANDORT,
  MELDUNG_VERWEIGERT,
  eigenpositionVerfuegbarkeit,
  type Eigenposition,
} from '../pages/lagekarte/useEigenposition';

/**
 * Standort einer Meldung auf Knopfdruck (LLH-1579, F3/F9): einmal ermittelt, keine laufende
 * Ortung. Formularfeld (`value`/`onChange` von `Form.Item`); `null` heißt ohne Standort. Der
 * Standort bleibt auf dem Gerät, bis die Meldung ihn mitnimmt.
 */
export default function StandortFeld({
  value,
  onChange,
  disabled,
}: {
  value?: Eigenposition | null;
  onChange?: (wert: Eigenposition | null) => void;
  disabled?: boolean;
}) {
  const { formatKoordinate, formatDistanz } = useAnzeigeKonventionen();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const verfuegbarkeit = eigenpositionVerfuegbarkeit();
  const sperrgrund = verfuegbarkeit === 'bereit' ? null : EIGENPOSITION_SPERRGRUND[verfuegbarkeit];

  const ermitteln = () => {
    if (verfuegbarkeit !== 'bereit') return;
    setLaeuft(true);
    setFehler(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLaeuft(false);
        onChange?.({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          genauigkeit: p.coords.accuracy,
        });
      },
      (e) => {
        setLaeuft(false);
        setFehler(e.code === e.PERMISSION_DENIED ? MELDUNG_VERWEIGERT : MELDUNG_KEIN_STANDORT);
      },
      // Wie die Lagekarte: endliche Frist für einen GPS-Kaltstart, ein frischer Wert genügt.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
  };

  if (value) {
    return (
      <Flex align="center" gap="small" wrap data-lfh="meldung-standort">
        <IconStandortZiel size={18} />
        <span>{formatKoordinate(value.lat, value.lon)}</span>
        <Typography.Text type="secondary">± {formatDistanz(value.genauigkeit)}</Typography.Text>
        <Button
          type="text"
          aria-label="Standort entfernen"
          icon={<IconKreuz size={16} />}
          disabled={disabled}
          onClick={() => onChange?.(null)}
        />
      </Flex>
    );
  }
  return (
    <Flex vertical gap={4}>
      <Button
        icon={<IconStandortZiel size={18} />}
        loading={laeuft}
        disabled={disabled || sperrgrund != null}
        onClick={ermitteln}
      >
        Mein Standort
      </Button>
      {(sperrgrund ?? fehler) && (
        <Typography.Text type="secondary">{sperrgrund ?? fehler}</Typography.Text>
      )}
    </Flex>
  );
}
