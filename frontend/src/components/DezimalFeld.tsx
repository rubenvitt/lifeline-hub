import { InputNumber } from 'antd';
import type { InputNumberProps } from 'antd';
import { useZahlEingabe } from './zahlRegel';

/**
 * Zahlfeld für Dezimalzahlen (LLH-1146), Gegenstück zu `MengenFeld`: zeigt das Dezimalkomma und
 * nimmt Komma wie Punkt an. Die deutsche Ziffernstatur bietet je nach Gerät nur eines von beiden,
 * und wer am Schreibtisch „8.5“ tippt, meint 8,5. Auch das typografische Minus „−“ (wie es der
 * Zahlenkern `anzeige/zahl.ts` schreibt) zählt beim Einfügen.
 *
 * Der zugängliche Name ist Pflicht (`beschriftung`), die Stellenzahl auch (`stellen`): sie legt
 * Anzeige, Pfeilschritt und die Prüfung fest (2 → 7,10, Schritt 0,01, „7,123“ abgelehnt statt
 * gerundet, LLH-1768). Ohne Stufenknöpfe, Begründung wie
 * `MengenFeld`; `inputMode="decimal"` öffnet die Ziffernstatur mit Trennzeichen.
 *
 * Wächter: `anzeige/zahl.guard.test.ts` (kein Dezimal-`InputNumber` außerhalb dieses Bausteins).
 */
export type DezimalFeldProps = Omit<
  InputNumberProps<number>,
  | 'controls'
  | 'aria-label'
  | 'precision'
  | 'step'
  | 'inputMode'
  | 'decimalSeparator'
  | 'parser'
  | 'formatter'
  | 'min'
  | 'max'
> & {
  /** Grenzen; geprüft, nicht gekappt (LLH-1768). */
  min?: number;
  max?: number;
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

/**
 * Mindestens `stellen` Nachkommastellen mit Komma, nie gekürzt: „7,1“ → „7,10“, „7,123“ bleibt
 * „7,123“ und wird abgelehnt statt gerundet (LLH-1768; früher `precision`).
 */
export function mitStellen(wert: number, stellen: number): string {
  const [ganz, bruch = ''] = String(wert).split('.');
  return `${ganz},${bruch.padEnd(stellen, '0')}`;
}

export function DezimalFeld({
  beschriftung,
  stellen,
  min,
  max,
  onChange,
  status,
  ...rest
}: DezimalFeldProps) {
  const { wert, grund, aendere } = useZahlEingabe({
    value: rest.value,
    grenzen: { min, max, stellen },
    onChange: onChange as ((wert: number | null) => void) | undefined,
  });
  return (
    <InputNumber<number>
      {...rest}
      status={grund ? 'error' : status}
      aria-invalid={grund ? true : rest['aria-invalid']}
      value={wert}
      onChange={aendere}
      formatter={(wert, { userTyping, input }) =>
        userTyping || wert === undefined || wert === null || String(wert) === ''
          ? input
          : mitStellen(Number(wert), stellen)
      }
      step={10 ** -stellen}
      decimalSeparator=","
      parser={parser}
      controls={false}
      inputMode="decimal"
      aria-label={beschriftung}
    />
  );
}
