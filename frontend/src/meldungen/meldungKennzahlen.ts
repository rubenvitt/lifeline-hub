import type { Meldung } from '../api/types';
import { MELDUNG_STATUS, istAbgeschlossen } from '../kommunikation';

/** Anzeigename je Meldungsart (Karte und Lagevortrag, LFH-871). */
export const MELDUNGSART_LABEL: Record<string, string> = {
  lagemeldung: 'Lagemeldung',
  sofortmeldung: 'Sofortmeldung',
  rueckmeldung: 'Rückmeldung',
  vollzugsmeldung: 'Vollzugsmeldung',
  anfrage: 'Anfrage',
  sonstige: 'Sonstige',
};

/**
 * Alarmzustand einer Meldung — dieselbe Regel wie der rote Rand von `MeldungKarte`:
 * bestätigungspflichtige, unbestätigte Sofortmeldung, deren Frist abgelaufen oder die eskaliert
 * ist. Rein, damit Karte und Kennzahl eine Regel haben.
 */
export function istAlarmiert(m: Meldung): boolean {
  return !!(m.bestaetigung_pflicht && !m.ist_bestaetigt && (m.ist_ueberfaellig || m.eskaliert));
}

interface MeldungKennzahlen {
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
