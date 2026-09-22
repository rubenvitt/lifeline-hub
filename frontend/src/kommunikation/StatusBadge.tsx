import { Tooltip } from 'antd';
import { StatusChip } from '../components/instrument';
import { phaseTon } from './kartenKante';
import type { KommPhase } from './phase';

/**
 * Status-Badge: Fachlabel des Moduls als getönte Statusfläche (Neuentwurf „Status als
 * getönte Fläche", `StatusChip`) im Ton der gemeinsamen Ober-Phase ({@link phaseTon}).
 * `title` (optional) zeigt eine Tooltip-Erklärung.
 *
 * Vorher ein antd-`Tag` mit antds STATUS-Farben (`PHASE_META.color`); die Phasenachse
 * bleibt dieselbe, nur ihre Darstellung ist die des Neuentwurfs. `data-phase` trägt die
 * Achse für Tests und Werkzeuge, `data-ton` (am Chip) die Farbe.
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
   * Eingangszustand (LFH-343 · C8, Befund H47): Achtung-Ton statt Phasenton, dazu
   * fett. Eine neue Meldung sah vorher exakt aus wie eine bereits gesichtete —
   * beide auf `phase: 'offen'`.
   *
   * Der zweite Kanal neben der Farbe ist das Gewicht UND der Wortlaut (WCAG 1.4.1);
   * die Farbe allein trüge die Aussage nicht.
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
