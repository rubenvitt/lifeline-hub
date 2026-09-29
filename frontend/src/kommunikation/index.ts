/**
 * Geteilte Kommunikations-Schicht — dünne Primitive für Chat, Erinnerung, Auftrag, Meldung und
 * Nachforderung.
 */
export {
  PHASE_META,
  PRIO_META,
  AUFTRAG_STATUS,
  MELDUNG_STATUS,
  NACHFORDERUNG_STATUS,
  ERINNERUNG_STATUS,
  BEFEHL_STATUS,
  LAGEBERICHT_STATUS,
  istAbgeschlossen,
  PRIO_ORDNUNG,
  prioRang,
} from './phase';
export type { KommPhase, KommPrio, StatusDeskriptor } from './phase';

export { faelligGruppe, GRUPPE_LABEL, GRUPPE_ORDNUNG } from './gruppierung';
export type { FaelligGruppe } from './gruppierung';

export { default as StatusBadge } from './StatusBadge';
export { default as PrioBadge } from './PrioBadge';
export { default as QuittungIndikator } from './QuittungIndikator';
