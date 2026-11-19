import { Feld, type FeldProps } from '../components/instrument';
import KoordinatenEingabe from './KoordinatenEingabe';
import { koordinatenRegel } from './koordinatenWert';

type Props = Omit<FeldProps, 'children' | 'rules' | 'breite'> & {
  /** Einsatz für die Ort-Zeile (Peilung), s. `KoordinatenEingabe`. */
  einsatzId?: number;
  /** `typ:id` der bearbeiteten Entität (Selbst-Ausschluss der Peilung). */
  exclude?: string;
};

/**
 * Koordinate als Formularfeld (LFH-517): `Feld` mit `koordinatenRegel`, damit eine ungültige
 * Eingabe das Absenden sperrt und leer erlaubt bleibt. Den Feldfehler zeigt das Formularfeld, die
 * Eingabe schweigt dazu (`fehlerImFormular`). Formulare senden über `alsLatLon`. Eine
 * `KoordinatenEingabe` in einem `Form.Item` ohne diese Regel ist ein Fehler. Die Breite ist die
 * des Einbauorts (`breite="voll"`): ein gemeinsamer Baustein legt keine eigene Obergrenze fest.
 */
export default function KoordinatenFeld({ einsatzId, exclude, ...item }: Props) {
  return (
    <Feld {...item} breite="voll" rules={[koordinatenRegel]}>
      <KoordinatenEingabe einsatzId={einsatzId} exclude={exclude} fehlerImFormular />
    </Feld>
  );
}
