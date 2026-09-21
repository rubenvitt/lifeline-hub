import type { Meldung } from '../api/types';
import { MELDUNG_STATUS, istAbgeschlossen } from '../kommunikation';

/**
 * Alarmzustand einer Meldung — dieselbe Regel, die `MeldungKarte` für ihren roten Rand
 * fährt: eine bestätigungspflichtige, noch unbestätigte Sofortmeldung, deren Frist
 * abgelaufen oder die eskaliert ist. Rein, damit Karte und Kennzahl nicht zwei Regeln
 * haben.
 */
export function istAlarmiert(m: Meldung): boolean {
  return !!(m.bestaetigung_pflicht && !m.ist_bestaetigt && (m.ist_ueberfaellig || m.eskaliert));
}

export interface MeldungKennzahlen {
  /** Offen und noch von niemandem angefasst (Eingangszustand, `unbearbeitet`). */
  unbearbeitet: number;
  /** Offen und bereits angefasst. */
  inArbeit: number;
  /** Alarmiert nach {@link istAlarmiert} — quer zur Phase. */
  alarmiert: number;
  /** Abgeschlossen (inkl. Ausnahme). */
  erledigt: number;
}

/**
 * Die Mengen des Kennzahlenbands der Meldungsseite — aus derselben Liste und derselben
 * Phasen-Semantik wie die Gruppen darunter, damit Zahl und Liste nie auseinanderlaufen.
 */
export function meldungKennzahlen(meldungen: readonly Meldung[]): MeldungKennzahlen {
  const k: MeldungKennzahlen = { unbearbeitet: 0, inArbeit: 0, alarmiert: 0, erledigt: 0 };
  for (const m of meldungen) {
    const status = MELDUNG_STATUS[m.status];
    if (istAbgeschlossen(status?.phase ?? 'offen')) k.erledigt += 1;
    else if (status?.unbearbeitet) k.unbearbeitet += 1;
    else k.inArbeit += 1;
    if (istAlarmiert(m)) k.alarmiert += 1;
  }
  return k;
}
