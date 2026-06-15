import { Tag, Tooltip } from 'antd';
import { PHASE_META, type KommPhase } from './phase';

/**
 * Status-Badge: Fachlabel des Moduls in der Farbe der gemeinsamen Ober-Phase.
 * `title` (optional) zeigt eine Tooltip-Erklärung.
 */
export default function StatusBadge({ phase, label, title }: {
  phase: KommPhase;
  label: string;
  title?: string;
}) {
  const tag = <Tag color={PHASE_META[phase].color}>{label}</Tag>;
  return title ? <Tooltip title={title}>{tag}</Tooltip> : tag;
}
