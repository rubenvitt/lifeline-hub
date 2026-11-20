import { InputNumber } from 'antd';
import type { InputNumberProps } from 'antd';
import { useZahlSperre } from './zahlRegel';

/**
 * Zahlfeld für Mengen (LFH-983). Der zugängliche Name ist Pflicht (`beschriftung`), auch im
 * `Form.Item` mit Etikett: in einer Tabellenzeile nennt er die Position („Menge Decken“).
 *
 * Ohne Stufenknöpfe (`controls={false}`): rc-input-number schreibt ihnen fest „Increase Value“ bzw.
 * „Decrease Value“ als Namen an (`StepHandler.js`), und am Touchschirm stehen sie nur beim Hover.
 * Pfeil hoch und runter stufen weiter, die Ziffernstatur öffnet `inputMode="numeric"`.
 */
export type MengenFeldProps = Omit<
  InputNumberProps<number>,
  'controls' | 'aria-label' | 'precision' | 'inputMode' | 'min' | 'max'
> & {
  /** Zugänglicher Name, z. B. „Menge“ oder „Menge Decken“. */
  beschriftung: string;
  /** Untergrenze, Vorgabe 1. Geprüft, nicht gekappt (LLH-1768). */
  min?: number;
  max?: number;
};

/**
 * Ganze Zahlen ab `min`: eine Eingabe außerhalb wird nicht gekappt oder gerundet, sondern bleibt
 * stehen; der Grund sperrt das Formular darüber (`zahlRegel.ts`, `useZahlSperre`, LLH-1768).
 */
export function MengenFeld({
  beschriftung,
  min = 1,
  max,
  onChange,
  status,
  ...rest
}: MengenFeldProps) {
  const { grund, pruefe } = useZahlSperre();
  return (
    <InputNumber<number>
      {...rest}
      status={grund ? 'error' : status}
      aria-invalid={grund ? true : rest['aria-invalid']}
      onChange={(wert) => {
        pruefe(wert, { min, max, ganz: true });
        onChange?.(wert);
      }}
      controls={false}
      inputMode="numeric"
      aria-label={beschriftung}
    />
  );
}
