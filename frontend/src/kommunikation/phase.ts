/**
 * Geteilte Status-/Prio-Semantik der Kommunikations-Module.
 *
 * Drei gemeinsame Ober-Phasen (+ Ausnahme). Jedes Modul mappt seine Status-Strings darauf und
 * behält sein Fachlabel. „Quittiert" ist eine ORTHOGONALE Achse, nicht Teil der Phase (siehe
 * QuittungIndikator).
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

/** Reihenfolge der Prioritäten (dringlichste zuerst) = Schlüsselreihenfolge von PRIO_META. */
export const PRIO_ORDNUNG = Object.keys(PRIO_META) as KommPrio[];

/** Sortier-Rang einer Priorität: sofort(0) < dringend(1) < normal(2); Unbekanntes zuletzt. */
export function prioRang(prio: string): number {
  const rang = PRIO_ORDNUNG.indexOf(prio as KommPrio);
  return rang === -1 ? PRIO_ORDNUNG.length : rang;
}

/**
 * Status-Deskriptor eines Moduls: Fachlabel + gemeinsame Ober-Phase.
 *
 * `unbearbeitet` markiert den EINGANGSZUSTAND (noch von niemandem angefasst) mit eigenem
 * Akzent. Bewusst KEINE fünfte {@link KommPhase}: Befehls-/Lagebericht-Entwurf, offene
 * Erinnerung und angeforderte Nachforderung liegen ebenfalls auf `offen` und wären von einer
 * neuen Phase zu „neu" umklassifiziert worden. Die Marke gehört an den Status, nicht an die Achse.
 */
export type StatusDeskriptor = Record<
  string,
  { label: string; phase: KommPhase; unbearbeitet?: true }
>;

/** AUFTRAG (AuftragBearbeitungsstatus). */
export const AUFTRAG_STATUS: StatusDeskriptor = {
  offen: { label: 'Offen', phase: 'offen', unbearbeitet: true },
  in_arbeit: { label: 'In Bearbeitung', phase: 'in_arbeit' },
  vollzogen: { label: 'Vollzogen', phase: 'abgeschlossen' },
  abgenommen: { label: 'Abgenommen', phase: 'abgeschlossen' },
};

/** MELDUNG (MeldungStatus). */
export const MELDUNG_STATUS: StatusDeskriptor = {
  neu: { label: 'Neu', phase: 'offen', unbearbeitet: true },
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
 * BEFEHL (`BefehlStatus` — `'entwurf' | 'freigegeben'`).
 * Die Fortschreibung erzeugt eine NEUE Zeile mit `version + 1` im Status `entwurf`, der
 * Vorgänger bleibt `freigegeben` — beide Fassungen stehen gleichzeitig in der Liste.
 */
export const BEFEHL_STATUS: StatusDeskriptor = {
  entwurf: { label: 'Entwurf', phase: 'offen' },
  freigegeben: { label: 'Freigegeben', phase: 'abgeschlossen' },
};

/**
 * LAGEBERICHT (`LageberichtStatus` — dieselben zwei Werte).
 * Bewusst dieselbe Achse wie {@link BEFEHL_STATUS} und nicht deren Alias: eine spätere
 * Divergenz soll eine Entscheidung sein, keine Umbenennung (gepinnt in `phase.test.ts`).
 */
export const LAGEBERICHT_STATUS: StatusDeskriptor = {
  entwurf: { label: 'Entwurf', phase: 'offen' },
  freigegeben: { label: 'Freigegeben', phase: 'abgeschlossen' },
};

/**
 * Trennung Offen/Abgeschlossen-Ansicht: abgeschlossen UND ausnahme (z. B.
 * abgelehnte Nachforderung) zählen für die Abgeschlossen-Ansicht.
 */
export function istAbgeschlossen(phase: KommPhase): boolean {
  return phase === 'abgeschlossen' || phase === 'ausnahme';
}
