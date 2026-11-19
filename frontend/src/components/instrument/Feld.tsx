import type { CSSProperties } from 'react';
import { Form, type FormItemProps } from 'antd';
import type { NamePath } from 'antd/es/form/interface';
import { FELDBREITE, type Feldbreite } from '../../theme/tokens';
import GeaendertPunkt from './GeaendertPunkt';

/**
 * Feld — ein Formularfeld mit benannter Obergrenze (Spec `feldbreiten`, LLH-1810). Hülle um antds
 * `Form.Item`: Beschriftung, Pflichtzeichen, Hinweis, Prüfung und Fehlerzeile bleiben antds. Das
 * Steuerelement füllt die Zeile bis zur Obergrenze der Stufe (`FELDBREITE`) und ragt am schmalen
 * Schirm nie über den Rand. `InputNumber`, `DatePicker` und `TimePicker`, die antd nicht von sich
 * aus 100 % breit setzt, füllt die Klasse {@link FELD_KLASSE} in `index.css`.
 *
 * Bewusst ohne `style`: eine Pixelbreite lässt sich nicht ausdrücken. Ein Sonderfall wird eine
 * neue Stufe, keine Ausnahme. Für Felder nebeneinander in einer Zeile und für das letzte Feld
 * eines Dialogs gibt es zwei benannte Optionen (LLH-1999): `abstand="ohne"` lässt den Feldabstand
 * darunter weg, `zeile` gibt den Flex-Anteil als Stufe aus `FELDBREITE`. Regel: `frontend/AGENTS.md`, „Gestaltungssprache“, Bausteine;
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
  /** Abstand unter dem Feld; `ohne` für Felder einer Zeile und das letzte Feld eines Dialogs. */
  abstand?: Feldabstand;
  /**
   * Anteil in einer Feldzeile (Flex-Container): Basis ist die Stufe aus `FELDBREITE`, das Feld
   * wächst und schrumpft von dort; `voll` teilt sich den Rest ohne Basis. Ohne Angabe kein Anteil.
   */
  zeile?: Feldbreite;
}

export type Feldabstand = 'normal' | 'ohne';

/** Der Stil des Formularfelds aus den benannten Optionen — die einzige Stelle mit Zahlen. */
function feldStil(
  breite: Feldbreite,
  abstand: Feldabstand,
  zeile: Feldbreite | undefined,
): CSSProperties | undefined {
  const stil: Record<string, string | number> = {};
  const grenze = FELDBREITE[breite];
  if (grenze !== undefined) stil[FELD_GRENZE] = `${grenze}px`;
  if (abstand === 'ohne') stil.marginBottom = 0;
  if (zeile !== undefined) {
    stil.flex = `1 1 ${FELDBREITE[zeile] ?? 0}px`;
    // Ohne `minWidth: 0` schrumpft ein Flex-Kind nie unter die Breite seines Inhalts.
    stil.minWidth = 0;
  }
  return Object.keys(stil).length === 0 ? undefined : (stil as CSSProperties);
}

export default function Feld<Values = unknown>({
  breite = 'voll',
  abstand = 'normal',
  zeile,
  className,
  label,
  messageVariables,
  ...props
}: FeldProps<Values>) {
  return (
    <Form.Item<Values>
      {...props}
      // Das Etikett ist unten ein Fragment; antd setzte `${label}` in Prüfmeldungen sonst aus dem
      // Feldnamen. Ein Text-Etikett geht deshalb ausdrücklich mit (LLH-1829, Review).
      messageVariables={
        typeof label === 'string' ? { label, ...messageVariables } : messageVariables
      }
      // Ein geändertes Feld trägt den Punkt am Etikett (LLH-1829); ohne Etikett kein Punkt.
      label={
        label === undefined ? undefined : (
          <>
            {label}
            <GeaendertPunkt name={props.name as NamePath | undefined} />
          </>
        )
      }
      className={className ? `${FELD_KLASSE} ${className}` : FELD_KLASSE}
      style={feldStil(breite, abstand, zeile)}
    />
  );
}
