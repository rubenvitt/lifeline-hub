import { InputNumber } from 'antd';
import type { InputNumberProps } from 'antd';

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
  'controls' | 'aria-label' | 'precision' | 'inputMode'
> & {
  /** Zugänglicher Name, z. B. „Menge“ oder „Menge Decken“. */
  beschriftung: string;
};

export function MengenFeld({ beschriftung, min = 1, ...rest }: MengenFeldProps) {
  return (
    <InputNumber<number>
      {...rest}
      min={min}
      precision={0}
      controls={false}
      inputMode="numeric"
      aria-label={beschriftung}
    />
  );
}
