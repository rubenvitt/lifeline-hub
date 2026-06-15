import { Tag } from 'antd';
import { PRIO_META, type KommPrio } from './phase';

/** Prioritäts-Badge (Single-Source aus PRIO_META). */
export default function PrioBadge({ prio }: { prio: KommPrio }) {
  const meta = PRIO_META[prio] ?? PRIO_META.normal;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}
