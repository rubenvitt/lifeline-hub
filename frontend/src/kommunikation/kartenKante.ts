import type { StatusTon } from '../components/instrument';
import type { Farbrollen } from '../theme/tokens';
import type { KommPhase, KommPrio } from './phase';

type KantenZustand = 'alarm' | 'unbearbeitet' | 'keine';

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
 * Grund der Kommunikations-Karte — Gefahr gewinnt auch gegen die Deeplink-Markierung (LFH-896,
 * Spec `deeplink-hervorhebung`): `alarmFlaeche` vor `bedienFlaeche` vor `auswahlFlaeche` vor
 * `paneel`. Eine angesprungene Alarmkarte behält ihre Fläche, die Markierung trägt dort nur die
 * Linien. Die Auswahl (gewählte Karte im Muster „Liste + Detailpaneel“, Spec `liste-detail`) liegt
 * unter der Markierung: angesprungen heißt zugleich gewählt.
 */
export function kartenGrund(
  rollen: Pick<Farbrollen, 'alarmFlaeche' | 'bedienFlaeche' | 'auswahlFlaeche' | 'paneel'>,
  {
    alarm,
    hervorgehoben,
    gewaehlt = false,
  }: { alarm: boolean; hervorgehoben: boolean; gewaehlt?: boolean },
): string {
  if (alarm) return rollen.alarmFlaeche;
  if (hervorgehoben) return rollen.bedienFlaeche;
  if (gewaehlt) return rollen.auswahlFlaeche;
  return rollen.paneel;
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
