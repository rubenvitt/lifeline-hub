import { Button, InputNumber } from 'antd';
import { monoStil, useRollen } from './instrument';
import { KREIS_RADIUS_M_MAX } from '../api/eingabegrenzen';

/** Schnellwahl des Radius in Metern (LLH-1043): Erstabsperrung bis Evakuierungsradius. */
export const KREIS_SCHNELLWAHL = [50, 100, 300, 500, 1000] as const;

interface RadiusEingabeProps {
  /** Vom `Form.Item` gereicht, damit sein Etikett das Feld benennt. */
  id?: string;
  value?: number | null;
  onChange?: (radiusM: number | null) => void;
  disabled?: boolean;
  onPressEnter?: () => void;
}

/**
 * Radius eines Kreises in Metern: Zahl und Schnellwahl als Knöpfe (LLH-1043, LLH-1346). Eine
 * Wahrheit für das Kreis-Band der Lagekarte und die Gebietswahl beim Anlegen eines
 * Evakuierungsbezirks. Handschuhtauglich: jeder Schnellwert ist ein Knopf, die gewählte Stufe
 * steht gedrückt (`aria-pressed`) und hervorgehoben. Mit `value`/`onChange` auch als Formularfeld.
 */
export default function RadiusEingabe({
  id,
  value,
  onChange,
  disabled,
  onPressEnter,
}: RadiusEingabeProps) {
  const { token } = useRollen();
  const radius = value ?? null;
  return (
    <>
      <InputNumber<number>
        id={id}
        aria-label="Radius in Metern"
        value={radius}
        min={1}
        max={KREIS_RADIUS_M_MAX}
        precision={0}
        disabled={disabled}
        suffix="m"
        inputMode="numeric"
        style={{ width: 132, ...monoStil(token.fontSize) }}
        onChange={(v) => onChange?.(typeof v === 'number' ? v : null)}
        onPressEnter={onPressEnter}
      />
      {KREIS_SCHNELLWAHL.map((r) => (
        <Button
          key={r}
          disabled={disabled}
          aria-pressed={radius === r}
          type={radius === r ? 'primary' : 'default'}
          ghost={radius === r}
          onClick={() => onChange?.(r)}
        >
          {r} m
        </Button>
      ))}
    </>
  );
}
