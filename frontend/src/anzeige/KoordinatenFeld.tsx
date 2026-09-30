import { Form, type FormItemProps } from 'antd';
import KoordinatenEingabe from './KoordinatenEingabe';
import { koordinatenRegel } from './koordinatenWert';

type Props = Omit<FormItemProps, 'children' | 'rules'> & {
  /** Einsatz für die Ort-Zeile (Peilung), s. `KoordinatenEingabe`. */
  einsatzId?: number;
  /** `typ:id` der bearbeiteten Entität (Selbst-Ausschluss der Peilung). */
  exclude?: string;
};

/**
 * Koordinate als Formularfeld (LFH-517): `Form.Item` mit `koordinatenRegel`, damit eine
 * ungültige Eingabe das Absenden sperrt und leer erlaubt bleibt. Den Feldfehler zeigt das
 * `Form.Item`, die Eingabe schweigt dazu (`fehlerImFormular`). Formulare senden über
 * `alsLatLon`. Eine `KoordinatenEingabe` in einem `Form.Item` ohne diese Regel ist ein Fehler.
 */
export default function KoordinatenFeld({ einsatzId, exclude, ...item }: Props) {
  return (
    <Form.Item {...item} rules={[koordinatenRegel]}>
      <KoordinatenEingabe einsatzId={einsatzId} exclude={exclude} fehlerImFormular />
    </Form.Item>
  );
}
