import TaktischesZeichen from 'taktische-zeichen-react';
import { baueTzProps } from '../pages/lagekarte/taktischesZeichen';
import { useRollen } from '../components/instrument';
import type { TzEinheit } from './meldebildRaster';

/**
 * Der Symbolplatz „TZ" der Einheitenzeile: das taktische Zeichen der Einheit, 26 × 26 px.
 * Dieselbe Ableitung wie auf der Lagekarte (`baueTzProps`). Der Organisations-Vorgabewert der
 * Karte fehlt bewusst — eine weitere Query für einen Zierrahmen wäre zu teuer.
 * Reine Zierde, `aria-hidden`: die Bezeichnung daneben benennt die Einheit, und die Bibliothek
 * stellte sonst ein Bildziel mit englischem Namen in jede Zeile.
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
        <TaktischesZeichen
          {...baueTzProps({
            objekttyp: 'einheit',
            einheitTypLabel: tz.typLabel,
            fachaufgabe: tz.fachaufgabe,
            organisation: tz.organisation,
          })}
          style={{ width: 22, height: 22 }}
        />
      )}
    </span>
  );
}
