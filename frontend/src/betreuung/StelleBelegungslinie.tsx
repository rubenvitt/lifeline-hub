import { useQuery } from '@tanstack/react-query';
import { ladeBelegungVerlauf } from '../api/betreuung';
import { einsatzKeys } from '../api/queryKeys';
import type { BelegungVerlaufEintrag } from '../api/types';
import Stufenlinie from './Stufenlinie';
import { personenZahl } from './betreuungText';
import { belegungAussage, belegungStufen, type Stufe } from './standlinieKern';

/**
 * Stufenlinie „Belegung über die Zeit“ einer Betreuungsstelle (LLH-1347), die Kapazität
 * gestrichelt, wenn die Stelle eine hat. Muster und Regeln wie die Standlinie eines Bezirks
 * (LLH-1076): ab zwei gültigen Meldungen, ohne Interpolation, Ende an der jüngsten Meldung.
 */
export default function StelleBelegungslinie({
  einsatzId,
  stelleId,
  kapazitaet,
}: {
  einsatzId: number;
  stelleId: number;
  kapazitaet: number | null;
}) {
  // Dieselbe Abfrage wie `MeldeVerlauf` (ein Schlüssel, ein Abruf), eigenes `select`.
  const abfrage = useQuery<BelegungVerlaufEintrag[], Error, Stufe[]>({
    queryKey: einsatzKeys.betreuungVerlauf(einsatzId, stelleId),
    queryFn: () => ladeBelegungVerlauf(einsatzId, stelleId),
    select: belegungStufen,
  });
  return (
    <Stufenlinie
      kennung="stelle-belegungslinie"
      stufen={abfrage.data ?? []}
      bezug={
        kapazitaet == null
          ? null
          : { wert: kapazitaet, text: `Kapazität ${personenZahl(kapazitaet)}` }
      }
      aussage={(von, bis) => belegungAussage(abfrage.data ?? [], kapazitaet, von, bis)}
      punktTitel={(s, zeit) => `${personenZahl(s.wert)} belegt · ${zeit}`}
    />
  );
}
