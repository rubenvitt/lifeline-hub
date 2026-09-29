import { baueTzProps } from '../pages/lagekarte/taktischesZeichen';
import { useRollen } from '../components/instrument';
import EinsatzZeichen from '../zeichen/EinsatzZeichen';
import type { TzEinheit } from './meldebildRaster';

/**
 * Der Symbolplatz „TZ" der Einheitenzeile: das taktische Zeichen der Einheit, 26 × 26 px.
 * Dieselbe Ableitung wie auf der Lagekarte (`baueTzProps`) und dieselbe Zeichnung
 * (`EinsatzZeichen`, @einsatzzeichen, LFH-835). Der Organisations-Vorgabewert der Karte fehlt
 * bewusst — eine weitere Query für einen Zierrahmen wäre zu teuer.
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
        />
      )}
    </span>
  );
}
