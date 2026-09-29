import type { StatusTon } from '../components/instrument';
import type { Farbrollen } from '../theme/tokens';
import type { KommPhase, KommPrio } from './phase';

export type KantenZustand = 'alarm' | 'unbearbeitet' | 'keine';

/**
 * Der linke Kartenrand der Kommunikations-Karten — EINE Farbe, Gefahr gewinnt: `alarm` vor
 * `unbearbeitet`, sonst die Rahmenlinie. Rein, damit der Vorrang ohne Rendern prüfbar ist.
 */
export function kartenKante(
  rollen: Pick<Farbrollen, 'alarm' | 'achtung' | 'linie'>,
  { alarm, unbearbeitet }: { alarm: boolean; unbearbeitet: boolean },
): { zustand: KantenZustand; farbe: string } {
  if (alarm) return { zustand: 'alarm', farbe: rollen.alarm };
  if (unbearbeitet) return { zustand: 'unbearbeitet', farbe: rollen.achtung };
  return { zustand: 'keine', farbe: rollen.linie };
}

/**
 * Phase → Ton der Statusfläche. `in_arbeit` ist eine aktive Beziehung und trägt `bedien` (wie
 * `verfuegbarkeit.reserviert` in `theme/statusFarben.ts`); `ausnahme` ist `alarm`,
 * abgeschlossen `normal`, offen neutral. Der Eingangszustand schlägt die Phase und wird `achtung`.
 */
export function phaseTon(phase: KommPhase, unbearbeitet = false): StatusTon {
  if (unbearbeitet) return 'achtung';
  switch (phase) {
    case 'in_arbeit':
      return 'bedien';
    case 'abgeschlossen':
      return 'normal';
    case 'ausnahme':
      return 'alarm';
    default:
      return 'neutral';
  }
}

/** Priorität → Ton: sofort ist Alarm, dringend Achtung, normal neutral. */
export function prioTon(prio: KommPrio): StatusTon {
  return prio === 'sofort' ? 'alarm' : prio === 'dringend' ? 'achtung' : 'neutral';
}
