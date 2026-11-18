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

export interface FeldProps extends Omit<FormItemProps, 'style'> {
  /** Obergrenze der Breite; Vorgabe `voll` (ganze Zeile). */
  breite?: Feldbreite;
}

export default function Feld({ breite = 'voll', className, ...props }: FeldProps) {
  const grenze = FELDBREITE[breite];
  return (
    <Form.Item
      {...props}
      className={className ? `${FELD_KLASSE} ${className}` : FELD_KLASSE}
      style={grenze === undefined ? undefined : { maxWidth: grenze }}
    />
  );
}
