import { baueTzProps } from '../pages/lagekarte/taktischesZeichen';
import { useRollen } from '../components/instrument';
import EinsatzZeichen from '../zeichen/EinsatzZeichen';
import type { TzEinheit, TzFahrzeug } from './meldebildRaster';

/**
 * Der Symbolplatz „TZ" der Einheitenzeile: das taktische Zeichen der Einheit, 26 × 26 px.
 * Dieselbe Ableitung wie auf der Lagekarte (`baueTzProps`) und dieselbe Zeichnung
 * (`EinsatzZeichen`, @einsatzzeichen, LFH-835). Der Organisations-Vorgabewert der Karte fehlt
 * bewusst — eine weitere Query für einen Zierrahmen wäre zu teuer. Deshalb steht das Zeichen auf
 * der hellen Unterlage (LFH-1120): ohne eigene Organisation zeichnet die Bibliothek nur einen
 * schwarzen Umriss, im Nachtbetrieb sonst schwarz auf schwarz.
 * Reine Zierde, `aria-hidden`: die Bezeichnung daneben benennt die Einheit.
 */
export default function EinheitZeichen({ tz }: { tz: TzEinheit | null }) {
  const { rollen } = useRollen();
  return (
    <span
      aria-hidden
      data-lfh="einheit-zeichen"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 26px',
        width: 26,
        height: 26,
        border: `1px solid ${rollen.linieStark}`,
      }}
    >
      {tz && (
        <EinsatzZeichen
          tz={baueTzProps({
            objekttyp: 'einheit',
            einheitTypLabel: tz.typLabel,
            fachaufgabe: tz.fachaufgabe,
            organisation: tz.organisation,
          })}
          size={22}
          unterlage
        />
      )}
    </span>
  );
}

/**
 * Das taktische Zeichen eines Fahrzeugs in der Fahrzeugzeile des Kräftebaums (LLH-1025), 22 × 22
 * px und damit kleiner als das der Einheit: Zeichen UND Größe unterscheiden die Zeilenart ohne
 * Farbe (Graustufendruck). Grundzeichen aus dem Fahrzeugtyp, Organisation aus Träger bzw. OPTA,
 * wie auf der Lagekarte (`baueTzProps`); ohne Treffer der Rückfall „Fahrzeug“, nie ein leeres
 * Zeichen (Spec `lagekarte-taktische-zeichen`). Reine Zierde, `aria-hidden`.
 */
export function FahrzeugZeichen({ tz }: { tz: TzFahrzeug }) {
  const { rollen } = useRollen();
  return (
    <span
      aria-hidden
      data-lfh="fahrzeug-zeichen"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 22px',
        width: 22,
        height: 22,
        border: `1px solid ${rollen.linieStark}`,
      }}
    >
      <EinsatzZeichen
        tz={baueTzProps({
          objekttyp: 'fahrzeug',
          fahrzeugtyp: tz.fahrzeugtyp,
          traegerorganisation: tz.traegerorganisation,
          opta: tz.opta,
          fachaufgabe: tz.fachaufgabe,
          organisation: tz.organisation,
        })}
        size={18}
        unterlage
      />
    </span>
  );
}
