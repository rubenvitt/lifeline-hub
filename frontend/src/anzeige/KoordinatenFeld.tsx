import { Form, type FormItemProps } from 'antd';
import type { ReactNode } from 'react';
import KoordinatenEingabe from './KoordinatenEingabe';
import { koordinatenRegel } from './koordinatenWert';
import { DatenfeldEingabe } from '../components/instrument';

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

/**
 * Dieselbe Koordinate als Zelle im Bearbeiten-Modus einer Detailseite (`DatenfeldEingabe`,
 * LLH-1101): benannt über die Augenbraue, Regel `koordinatenRegel`, gesendet über `alsLatLon`.
 * Leer heißt „nicht verortet“ (LLH-1123, Fundort eines Tiers).
 */
export function KoordinatenDatenfeld({
  label,
  name,
  einsatzId,
  exclude,
}: {
  label: ReactNode;
  name: FormItemProps['name'];
  einsatzId?: number;
  exclude?: string;
}) {
  return (
    <DatenfeldEingabe label={label} name={name} rules={[koordinatenRegel]}>
      <KoordinatenEingabe einsatzId={einsatzId} exclude={exclude} fehlerImFormular />
    </DatenfeldEingabe>
  );
}
