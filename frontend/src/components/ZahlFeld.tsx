import { InputNumber } from 'antd';
import type { InputNumberProps } from 'antd';
import { useZahlEingabe, type ZahlGrenzen } from './zahlRegel';

export type ZahlFeldProps = Omit<InputNumberProps<number>, 'min' | 'max' | 'precision'> &
  Omit<ZahlGrenzen, 'stellen'> & {
    /**
     * Nur gültige Werte gehen über `onChange` hinaus; ein abgelehnter bleibt im Feld stehen.
     * Vorgabe: an, wenn keine Sperrstelle darüber steht (kein `Feld`, keine `InlineAngabe`).
     */
    nurGueltig?: boolean;
    /** Meldet den Grund (`null` = gültig), etwa um einen Knopf daneben zu sperren. */
    onGrund?: (grund: string | null) => void;
  };

/**
 * Zahlenfeld mit Grenzen, die geprüft statt gekappt werden (LLH-1768, `frontend/AGENTS.md`,
 * „Zahlenfelder prüfen statt kappen“): an Stelle von `InputNumber` mit `min`, `max` oder
 * `precision` (Wächter `components/zahlfeld.guard.test.ts`). Eine Eingabe außerhalb bleibt
 * stehen, das Feld zeigt den Fehlerzustand, und die Eingabesperre darüber (`Feld`,
 * `DatenfeldEingabe`, `InlineAngabe`) sendet nicht und nennt den Grund.
 */
export function ZahlFeld({
  min,
  max,
  ganz,
  einheit,
  nurGueltig,
  onGrund,
  onChange,
  status,
  value,
  ...rest
}: ZahlFeldProps) {
  const { wert, grund, aendere } = useZahlEingabe({
    value,
    grenzen: { min, max, ganz, einheit },
    onChange,
    nurGueltig,
    onGrund,
  });
  return (
    <InputNumber<number>
      {...rest}
      value={wert}
      status={grund ? 'error' : status}
      aria-invalid={grund ? true : rest['aria-invalid']}
      onChange={aendere}
    />
  );
}
