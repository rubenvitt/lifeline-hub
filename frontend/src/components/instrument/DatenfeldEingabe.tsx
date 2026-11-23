import { cloneElement, useId, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Form } from 'antd';
import type { FormItemProps, FormRule } from 'antd';
import Feldetikett from './Feldetikett';
import { FELDBREITE, type Feldbreite } from '../../theme/tokens';
import { FELD_GRENZE, FELD_KLASSE } from './Feld';
import GeaendertPunkt from './GeaendertPunkt';
import { useRollen } from './rollenwerte';
import { datenfeldStil } from './datenrasterStil';
import { SperrStelle, useSperrStelle } from './eingabeSperre';

/**
 * DatenfeldEingabe — ein `Datenfeld` im Bearbeiten-Modus einer Detailseite (LLH-1101): dieselbe
 * Zelle im `Datenraster` wie die Anzeige, der Wert ist eine Eingabe im `Form.Item` der Seite.
 *
 * - **Benannt:** der Begriff ist ein `<label htmlFor>` auf die Eingabe. Ein `<dt>` allein benennt
 *   kein Feld; Vorleser und `getByLabelText` fänden es nicht. Die Kennung kommt aus `useId`, eine
 *   eigene `id` an der Eingabe gewinnt. Eigene Auswahlbausteine reichen `id` an ihr `Select`
 *   durch (`GeschaedigtPicker`, `HalterPicker`).
 * - **Prüffehler sichtbar:** das `Form.Item` trägt KEIN `noStyle` und kein Etikett. So rendert
 *   antd die Meldung der Regel unter der Eingabe (Farbe über das `Form`-Token `colorError` =
 *   `alarmText`, eine Optik mit `FeldFehler`) und setzt `aria-invalid` und `aria-describedby` an
 *   die Eingabe. Mit `noStyle` scheiterte das Speichern still.
 * - **Fokus:** antd fokussiert über den `ref` der Eingabe, nicht über ihre `id`;
 *   `scrollToFirstError={{ focus: true }}` am Formular der Seite bleibt also wirksam.
 *
 * Kein unterer Rand am `Form.Item`: die Zelle trägt ihr Polster selbst, eine Meldung macht sie
 * höher. Die Klasse von `Feld` (`FELD_KLASSE`) zieht auch `InputNumber`, `DatePicker` und
 * `Select` auf die Zellbreite, ohne Breite an der Eingabe (Feld-Wächter, LLH-1970). Eine schmalere
 * Obergrenze nennt `breite` wie bei `Feld` (LLH-2000): die Eingabe wird geklont und lässt sich
 * deshalb nicht in eine eigene `Feld`-Hülle setzen.
 */
export interface DatenfeldEingabeProps {
  /** Begriff — Augenbraue und zugänglicher Name der Eingabe. */
  label: ReactNode;
  /** Feldname im Formular der Seite. */
  name: FormItemProps['name'];
  /** Prüfregeln; ihre Meldung steht unter der Eingabe. */
  rules?: FormRule[];
  /** Über alle Spalten (Freitext, Auswahl mit langen Einträgen). */
  breit?: boolean;
  /** Obergrenze der Eingabe (`FELDBREITE`); ohne Stufe füllt sie die Zelle. */
  breite?: Feldbreite;
  /**
   * Hilfe unter der Eingabe (antds `extra`, etwa ein Vorschlag mit Herkunft, LLH-1139); die
   * Eingabe verweist per `aria-describedby` auf sie. Keine Bedienerklärung (`frontend/AGENTS.md`,
   * „Texte“).
   */
  hilfe?: ReactNode;
  /** Genau eine Eingabe (`Input`, `Select`, `InputNumber` …), die `id` annimmt. */
  children: ReactElement<{ id?: string }>;
}

export default function DatenfeldEingabe({
  label,
  name,
  rules,
  breit = false,
  breite,
  hilfe,
  children,
}: DatenfeldEingabeProps) {
  const { token, rollen } = useRollen();
  const erzeugt = useId();
  const eingabeId = children.props.id ?? erzeugt;
  const grenze = breite === undefined ? undefined : FELDBREITE[breite];
  // Eingabesperre wie in `Feld` (LLH-1768).
  const sperre = useSperrStelle(name);
  return (
    <div data-lfh="datenfeld" style={datenfeldStil(rollen, token, breit)}>
      <Feldetikett als="dt">
        <label htmlFor={eingabeId}>
          {label}
          <GeaendertPunkt name={name} />
        </label>
      </Feldetikett>
      <dd style={{ margin: 0, minWidth: 0 }}>
        <SperrStelle melden={sperre.melden}>
          <Form.Item
            name={name}
            rules={[...(rules ?? []), sperre.regel]}
            extra={hilfe}
            className={FELD_KLASSE}
            style={
              {
                marginBottom: 0,
                ...(grenze === undefined ? {} : { [FELD_GRENZE]: `${grenze}px` }),
              } as CSSProperties
            }
          >
            {cloneElement(children, { id: eingabeId })}
          </Form.Item>
        </SperrStelle>
      </dd>
    </div>
  );
}
