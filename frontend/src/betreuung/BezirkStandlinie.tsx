import { useQuery } from '@tanstack/react-query';
import { ladeStandVerlauf } from '../api/evakuierung';
import { einsatzKeys } from '../api/queryKeys';
import type { StandVerlaufEintrag } from '../api/types';
import Stufenlinie from './Stufenlinie';
import { personenZahl } from './betreuungText';
import { standStufen, stufenAussage, type Stufe } from './standlinieKern';

/**
 * Stufenlinie „Stand evakuiert über die Zeit“ eines Bezirks (LLH-1076, design.md D7), die
 * Plangröße gestrichelt. Darstellung in `Stufenlinie.tsx`, Regeln im Kern `standlinieKern.ts`.
 */
export default function BezirkStandlinie({
  einsatzId,
  bezirkId,
  plan,
}: {
  einsatzId: number;
  bezirkId: number;
  plan: number;
}) {
  // Dieselbe Abfrage wie `MeldeVerlauf` (ein Schlüssel, ein Abruf), eigenes `select`.
  const abfrage = useQuery<StandVerlaufEintrag[], Error, Stufe[]>({
    queryKey: einsatzKeys.evakuierungVerlauf(einsatzId, bezirkId),
    queryFn: () => ladeStandVerlauf(einsatzId, bezirkId),
    select: standStufen,
  });
  return (
    <Stufenlinie
      kennung="bezirk-standlinie"
      stufen={abfrage.data ?? []}
      bezug={{ wert: plan, text: `Plangröße ${personenZahl(plan)}` }}
      aussage={(von, bis) => stufenAussage(abfrage.data ?? [], plan, von, bis)}
      punktTitel={(s, zeit) =>
        `${s.geschaetzt ? '≈ ' : ''}${personenZahl(s.wert)} evakuiert · ${zeit}`
      }
    />
  );
}
