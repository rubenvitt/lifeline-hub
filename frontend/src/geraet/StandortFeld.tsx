import { useEffect, useRef, useState } from 'react';
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
 *
 * Eine Antwort, die erst nach dem Senden kommt, verfällt: Zurücksetzen hängt das Feld neu ein
 * (rc-field-form), und eine alte Ermittlung darf die nächste Meldung nicht verorten.
 *
 * `sofort` (Kontakt am Einheitengerät, LLH-1580 K6): ermittelt einmal beim Einhängen, das Öffnen
 * des Kontakts ist der Knopfdruck. Ohne Freigabe bleibt der Knopf.
 */
export default function StandortFeld({
  value,
  onChange,
  disabled,
  sofort = false,
}: {
  value?: Eigenposition | null;
  onChange?: (wert: Eigenposition | null) => void;
  disabled?: boolean;
  sofort?: boolean;
}) {
  const { formatKoordinate, formatDistanz } = useAnzeigeKonventionen();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const verfuegbarkeit = eigenpositionVerfuegbarkeit();
  const sperrgrund = verfuegbarkeit === 'bereit' ? null : EIGENPOSITION_SPERRGRUND[verfuegbarkeit];
  const anfrage = useRef(0);
  useEffect(
    () => () => {
      anfrage.current += 1;
    },
    [],
  );

  const ermitteln = () => {
    if (verfuegbarkeit !== 'bereit') return;
    const nr = ++anfrage.current;
    setLaeuft(true);
    setFehler(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (nr !== anfrage.current) return;
        setLaeuft(false);
        onChange?.({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          genauigkeit: p.coords.accuracy,
        });
      },
      (e) => {
        if (nr !== anfrage.current) return;
        setLaeuft(false);
        setFehler(e.code === e.PERMISSION_DENIED ? MELDUNG_VERWEIGERT : MELDUNG_KEIN_STANDORT);
      },
      // Wie die Lagekarte: endliche Frist für einen GPS-Kaltstart, ein frischer Wert genügt.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
  };

  // Einmal je Einhängen; `ermitteln` liest nur Refs und Props des ersten Renders. Das Aushängen
  // verwirft die Anfrage; StrictMode hängt einmal aus und wieder ein, dann gilt die zweite.
  useEffect(() => {
    if (!sofort || value || disabled) return;
    ermitteln();
    return () => {
      anfrage.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim Einhängen
  }, []);

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
