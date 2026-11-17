import type { ReactNode } from 'react';
import Datenstand from '../components/Datenstand';
import { Augenbraue, monoStil, useRollen } from '../components/instrument';

/**
 * Kopf eines Inhaltsbereichs UNTER dem Seitenkopf, etwa ein Reiter mit eigener Menge und
 * eigener Anlegen-Aktion: Augenbraue als echte Überschrift (Vorgabe `h3`), Mengen in Mono,
 * Datenstand, rechts die Aktion — statt eines zweiten großen Titelblocks.
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
