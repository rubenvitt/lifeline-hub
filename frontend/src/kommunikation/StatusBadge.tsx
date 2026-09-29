import { Tooltip } from 'antd';
import { StatusChip } from '../components/instrument';
import { phaseTon } from './kartenKante';
import type { KommPhase } from './phase';

/**
 * Status-Badge: Fachlabel des Moduls als getönte Statusfläche im Ton der gemeinsamen
 * Ober-Phase ({@link phaseTon}). `data-phase` trägt die Achse für Tests, `data-ton` die Farbe.
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
   * Eingangszustand: Achtung-Ton statt Phasenton, dazu fett — zweiter Kanal neben der Farbe sind
   * Gewicht UND Wortlaut (WCAG 1.4.1).
   */
  unbearbeitet?: boolean;
}) {
  const chip = (
    <span data-lfh="komm-status" data-phase={phase} style={{ display: 'inline-flex' }}>
      <StatusChip
        ton={phaseTon(phase, unbearbeitet)}
        wort={label}
        style={unbearbeitet ? { fontWeight: 600 } : undefined}
      />
    </span>
  );
  return title ? <Tooltip title={title}>{chip}</Tooltip> : chip;
}
