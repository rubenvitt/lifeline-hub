import { InputNumber } from 'antd';
import type { InputNumberProps } from 'antd';
import { useState } from 'react';
import { useZahlSperre, type ZahlGrenzen } from './zahlRegel';

export type ZahlFeldProps = Omit<InputNumberProps<number>, 'min' | 'max' | 'precision'> &
  Omit<ZahlGrenzen, 'stellen'> & {
    /**
     * Nur gültige Werte gehen über `onChange` hinaus; ein abgelehnter bleibt im Feld stehen. Für
     * Felder ohne Formular darüber (keine Eingabesperre), deren Wert sonst still mitliefe.
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
  const { grund, pruefe } = useZahlSperre();
  const [abgelehnt, setAbgelehnt] = useState<number | null>(null);
  return (
    <InputNumber<number>
      {...rest}
      value={nurGueltig && grund ? abgelehnt : value}
      status={grund ? 'error' : status}
      aria-invalid={grund ? true : rest['aria-invalid']}
      onChange={(wert) => {
        const neu = pruefe(wert, { min, max, ganz, einheit });
        onGrund?.(neu);
        if (neu && nurGueltig) {
          setAbgelehnt(wert);
          return;
        }
        onChange?.(wert);
      }}
    />
  );
}
