import type { StatusTon } from '../components/instrument';
import type { Farbrollen } from '../theme/tokens';
import type { KommPhase, KommPrio } from './phase';

export type KantenZustand = 'alarm' | 'unbearbeitet' | 'keine';

/**
 * Der linke Kartenrand der Kommunikations-Karten (LFH-343 · C8, Befund H47) — EINE Farbe,
 * und Gefahr gewinnt: `alarm` vor `unbearbeitet`, sonst die Rahmenlinie. Rein, damit der
 * Vorrang ohne Rendern prüfbar ist.
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
 * Phase der Kommunikations-Achse → Ton der Statusfläche (Neuentwurf „Status als getönte
 * Fläche"). `in_arbeit` ist eine aktive Beziehung und trägt deshalb `bedien` — dieselbe
 * Lesart wie `verfuegbarkeit.reserviert`/`etbTyp.meldung` in `theme/statusFarben.ts`;
 * `ausnahme` (abgelehnt) ist `alarm`, abgeschlossen `normal`, offen neutral.
 *
 * Der Eingangszustand (`unbearbeitet`) schlägt die Phase und wird `achtung` — derselbe
 * Vorrang wie am Kartenrand.
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
