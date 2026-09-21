import type { ReactNode } from 'react';
import Datenstand from '../components/Datenstand';
import { Augenbraue, monoStil, useRollen } from '../components/instrument';

/**
 * Kopf eines Inhaltsbereichs UNTER dem Seitenkopf (Neuentwurf „Instrumententafel") —
 * etwa der Reiter „Aufträge" bzw. „Befehle" auf der Seite Aufträge/Befehle. Der Seitenkopf
 * (`EinsatzSeite`) trägt Titel und Primäraktion der SEITE; ein Reiter, der seine eigene
 * Menge und seine eigene Anlegen-Aktion hat, bekommt diese schmale Zeile statt eines
 * zweiten großen Titelblocks: Augenbraue als echte Überschrift, Mengen in Mono, Datenstand,
 * rechts die Aktion.
 *
 * Die Überschrift bleibt eine Überschrift (Vorgabe `h3` — unter dem `h4`-Seitentitel des
 * Rahmens liegt sie in der Gliederung der Reiter, wie vorher `Typography.Title level={3}`).
 */
export default function Bereichskopf({
  titel,
  meta,
  dataUpdatedAt,
  aktion,
  ueberschrift = 'h3',
}: {
  titel: string;
  /** Mono-Mengen („3 offen · 2 abgeschlossen"). */
  meta?: ReactNode;
  dataUpdatedAt?: number;
  aktion?: ReactNode;
  ueberschrift?: 'h2' | 'h3';
}) {
  const { token, rollen } = useRollen();
  return (
    <div
      data-lfh="bereichskopf"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: token.marginSM,
        marginBottom: token.margin,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          columnGap: token.marginSM,
          rowGap: 2,
          minWidth: 0,
        }}
      >
        <Augenbraue als={ueberschrift}>{titel}</Augenbraue>
        {meta != null && <span style={{ ...monoStil(11), color: rollen.gedaempft }}>{meta}</span>}
        {dataUpdatedAt != null && <Datenstand dataUpdatedAt={dataUpdatedAt} />}
      </div>
      {aktion}
    </div>
  );
}
