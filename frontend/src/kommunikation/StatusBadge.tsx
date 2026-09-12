import { Tag, Tooltip } from 'antd';
import { PHASE_META, type KommPhase } from './phase';

/**
 * Status-Badge: Fachlabel des Moduls in der Farbe der gemeinsamen Ober-Phase.
 * `title` (optional) zeigt eine Tooltip-Erklärung.
 */
export default function StatusBadge({
  phase,
  label,
  title,
  unbearbeitet,
}: {
  phase: KommPhase;
  label: string;
  title?: string;
  /**
   * Eingangszustand (LFH-343 · C8, Befund H47): Warnfarbe statt Phasenfarbe, dazu
   * fett. Eine neue Meldung sah vorher exakt aus wie eine bereits gesichtete —
   * beide auf `phase: 'offen'`, zwei graue Tags, drei Buchstaben Unterschied.
   *
   * Der zweite Kanal neben der Farbe ist das Gewicht UND der Wortlaut (WCAG 1.4.1);
   * die Farbe allein trüge die Aussage nicht.
   */
  unbearbeitet?: boolean;
}) {
  const tag = (
    <Tag
      color={unbearbeitet ? 'warning' : PHASE_META[phase].color}
      style={unbearbeitet ? { fontWeight: 600 } : undefined}
    >
      {label}
    </Tag>
  );
  return title ? <Tooltip title={title}>{tag}</Tooltip> : tag;
}
