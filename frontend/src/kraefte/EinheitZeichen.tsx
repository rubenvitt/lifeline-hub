import TaktischesZeichen from 'taktische-zeichen-react';
import { baueTzProps } from '../pages/lagekarte/taktischesZeichen';
import { useRollen } from '../components/instrument';
import type { TzEinheit } from './meldebildRaster';

/**
 * Der Symbolplatz „TZ" der Einheitenzeile (Neuentwurf S6): das taktische Zeichen der
 * Einheit, 26 × 26 px mit Haarrahmen.
 *
 * Die Ableitung ist DIESELBE wie auf der Lagekarte (`baueTzProps`, nur gelesen): Grundzeichen
 * „taktische Formation", Größe aus dem Typ-Label (Trupp/Staffel/Gruppe/Zug), Fachaufgabe und
 * Organisation aus den `tz_*`-Feldern der Einheit. Der Organisations-Vorgabewert der Karte
 * (`/api/organisation`) fehlt hier bewusst — eine achte Query für einen Zierrahmen wäre zu
 * teuer; ohne ihn zeichnet die Bibliothek die neutrale Formation.
 *
 * Reine Zierde: `aria-hidden`, weil die Bezeichnung daneben die Einheit benennt und die
 * Bibliothek sonst ein eigenes Bildziel mit englischem Namen in jede Zeile stellte.
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
