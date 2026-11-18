import { Status } from '../components/instrument';
import { prioTon } from './kartenKante';
import { PRIO_META, type KommPrio } from './phase';

/** Prioritäts-Badge als getönte Statusfläche (Single-Source-Wortlaut aus PRIO_META). */
export default function PrioBadge({ prio }: { prio: KommPrio }) {
  const meta = PRIO_META[prio] ?? PRIO_META.normal;
  return (
    <Status
      groesse="klein"
      ton={prioTon(prio in PRIO_META ? prio : 'normal')}
      wort={meta.label}
      style={{ fontWeight: 600 }}
    />
  );
}
