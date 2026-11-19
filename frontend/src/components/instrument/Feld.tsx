import type { CSSProperties } from 'react';
import { Form, type FormItemProps } from 'antd';
import { FELDBREITE, type Feldbreite } from '../../theme/tokens';

/**
 * Feld — ein Formularfeld mit benannter Obergrenze (Spec `feldbreiten`, LLH-1810). Hülle um antds
 * `Form.Item`: Beschriftung, Pflichtzeichen, Hinweis, Prüfung und Fehlerzeile bleiben antds. Das
 * Steuerelement füllt die Zeile bis zur Obergrenze der Stufe (`FELDBREITE`) und ragt am schmalen
 * Schirm nie über den Rand. `InputNumber`, `DatePicker` und `TimePicker`, die antd nicht von sich
 * aus 100 % breit setzt, füllt die Klasse {@link FELD_KLASSE} in `index.css`.
 *
 * Bewusst ohne `style`: eine Pixelbreite lässt sich nicht ausdrücken. Ein Sonderfall wird eine
 * neue Stufe, keine Ausnahme. Regel: `frontend/AGENTS.md`, „Gestaltungssprache“, Bausteine;
 * Wächter `components/feld.guard.test.ts`.
 */

export const FELD_KLASSE = 'lfh-formfeld';

/**
 * Custom Property, die die Obergrenze trägt. `index.css` setzt sie an die Steuerzeile des
 * Formularfelds, nicht an das ganze Feld: die Beschriftung darüber bleibt so breit wie die Spalte
 * und bricht nicht unnötig um.
 */
export const FELD_GRENZE = '--lfh-feldgrenze';

/** `Values` bindet `name` an die Formularwerte wie `Form.Item<Values>`. */
export interface FeldProps<Values = unknown> extends Omit<FormItemProps<Values>, 'style'> {
  /** Obergrenze der Breite; Vorgabe `voll` (ganze Zeile). */
  breite?: Feldbreite;
}

export default function Feld<Values = unknown>({
  breite = 'voll',
  className,
  ...props
}: FeldProps<Values>) {
  const grenze = FELDBREITE[breite];
  return (
    <Form.Item<Values>
      {...props}
      className={className ? `${FELD_KLASSE} ${className}` : FELD_KLASSE}
      style={grenze === undefined ? undefined : ({ [FELD_GRENZE]: `${grenze}px` } as CSSProperties)}
    />
  );
}
