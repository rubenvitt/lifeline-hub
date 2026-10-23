import { InputNumber } from 'antd';
import type { InputNumberProps } from 'antd';

/**
 * Zahlfeld für Dezimalzahlen (LLH-1146), Gegenstück zu `MengenFeld`: zeigt das Dezimalkomma und
 * nimmt Komma wie Punkt an. Die deutsche Ziffernstatur bietet je nach Gerät nur eines von beiden,
 * und wer am Schreibtisch „8.5“ tippt, meint 8,5. Auch das typografische Minus „−“ (wie es der
 * Zahlenkern `anzeige/zahl.ts` schreibt) zählt beim Einfügen.
 *
 * Der zugängliche Name ist Pflicht (`beschriftung`), die Stellenzahl auch (`stellen`): sie legt
 * Anzeige und Pfeilschritt fest (2 → 7,10 und Schritt 0,01). Ohne Stufenknöpfe, Begründung wie
 * `MengenFeld`; `inputMode="decimal"` öffnet die Ziffernstatur mit Trennzeichen.
 *
 * Wächter: `anzeige/zahl.guard.test.ts` (kein Dezimal-`InputNumber` außerhalb dieses Bausteins).
 */
export type DezimalFeldProps = Omit<
  InputNumberProps<number>,
  'controls' | 'aria-label' | 'precision' | 'step' | 'inputMode' | 'decimalSeparator' | 'parser'
> & {
  /** Zugänglicher Name, z. B. „Erwarteter Höchststand (m)“. */
  beschriftung: string;
  /** Nachkommastellen (≥ 1). */
  stellen: number;
};

/** „8,5“, „8.5“ und „−3,5“ → Zahltext mit Punkt für rc-input-number. */
export function parseDezimal(text: string | undefined): string {
  return (text ?? '')
    .replace(/\s/g, '')
    .replace(/−/g, '-')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');
}

/**
 * antd typisiert den Parser als `→ number`; rc-input-number reicht sein Ergebnis aber als Text an
 * `getMiniDecimal` weiter (auch sein eigener Standard-Parser liefert Text). Text hält „“ (leer →
 * kein Wert) und „8.“ (noch beim Tippen) auseinander, `Number()` machte daraus 0 bzw. 8.
 */
const parser = parseDezimal as unknown as NonNullable<InputNumberProps<number>['parser']>;

export function DezimalFeld({ beschriftung, stellen, ...rest }: DezimalFeldProps) {
  return (
    <InputNumber<number>
      {...rest}
      precision={stellen}
      step={10 ** -stellen}
      decimalSeparator=","
      parser={parser}
      controls={false}
      inputMode="decimal"
      aria-label={beschriftung}
    />
  );
}
