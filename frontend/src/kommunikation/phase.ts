/**
 * Geteilte Status-/Prio-Semantik der Kommunikations-Module (LFH-112).
 *
 * Drei gemeinsame Ober-Phasen (+ Ausnahme) mit festen antd-Tag-Farben. Jedes
 * Modul mappt seine eigenen Status-Strings auf diese Phasen, behält aber sein
 * Fachlabel als Badge-Text. „Quittiert" (Kenntnisnahme) ist eine ORTHOGONALE
 * Achse und NICHT Teil der Phase (siehe QuittungIndikator).
 */

export type KommPhase = 'offen' | 'in_arbeit' | 'abgeschlossen' | 'ausnahme';

export const PHASE_META: Record<KommPhase, { color: string; label: string }> = {
  offen: { color: 'default', label: 'Offen' },
  in_arbeit: { color: 'processing', label: 'In Arbeit' },
  abgeschlossen: { color: 'success', label: 'Abgeschlossen' },
  ausnahme: { color: 'error', label: 'Ausnahme' },
};

export type KommPrio = 'sofort' | 'dringend' | 'normal';

export const PRIO_META: Record<KommPrio, { color: string; label: string }> = {
  sofort: { color: 'red', label: 'Sofort' },
  dringend: { color: 'orange', label: 'Dringend' },
  normal: { color: 'default', label: 'Normal' },
};

/** Status-Deskriptor eines Moduls: Fachlabel + gemeinsame Ober-Phase. */
export type StatusDeskriptor = Record<string, { label: string; phase: KommPhase }>;

/** AUFTRAG (AuftragBearbeitungsstatus). */
export const AUFTRAG_STATUS: StatusDeskriptor = {
  offen: { label: 'Offen', phase: 'offen' },
  in_arbeit: { label: 'In Bearbeitung', phase: 'in_arbeit' },
  vollzogen: { label: 'Vollzogen', phase: 'abgeschlossen' },
  abgenommen: { label: 'Abgenommen', phase: 'abgeschlossen' },
};

/** MELDUNG (MeldungStatus). */
export const MELDUNG_STATUS: StatusDeskriptor = {
  neu: { label: 'Neu', phase: 'offen' },
  gesichtet: { label: 'Gesichtet', phase: 'offen' },
  in_bearbeitung: { label: 'In Bearbeitung', phase: 'in_arbeit' },
  erledigt: { label: 'Erledigt', phase: 'abgeschlossen' },
};

/** NACHFORDERUNG (NachforderungStatus). */
export const NACHFORDERUNG_STATUS: StatusDeskriptor = {
  angefordert: { label: 'Angefordert', phase: 'offen' },
  zugesagt: { label: 'Zugesagt', phase: 'in_arbeit' },
  unterwegs: { label: 'Unterwegs', phase: 'in_arbeit' },
  eingetroffen: { label: 'Eingetroffen', phase: 'abgeschlossen' },
  abgelehnt: { label: 'Abgelehnt', phase: 'ausnahme' },
};

/** ERINNERUNG (status 'offen' | 'erledigt' | 'quittiert'). */
export const ERINNERUNG_STATUS: StatusDeskriptor = {
  offen: { label: 'Offen', phase: 'offen' },
  erledigt: { label: 'Erledigt', phase: 'abgeschlossen' },
  quittiert: { label: 'Quittiert', phase: 'abgeschlossen' },
};

/**
 * Trennung Offen/Abgeschlossen-Ansicht: abgeschlossen UND ausnahme (z. B.
 * abgelehnte Nachforderung) zählen für die Abgeschlossen-Ansicht.
 */
export function istAbgeschlossen(phase: KommPhase): boolean {
  return phase === 'abgeschlossen' || phase === 'ausnahme';
}
