/**
 * Geteilte Kommunikations-Schicht (LFH-112) — dünne Primitive für die fünf
 * Module Chat/Erinnerung/Auftrag/Meldung/Nachforderung. Aufträge sind das Vorbild.
 */
export {
  AUFTRAG_STATUS,
  MELDUNG_STATUS,
  NACHFORDERUNG_STATUS,
  ERINNERUNG_STATUS,
  BEFEHL_STATUS,
  LAGEBERICHT_STATUS,
  istAbgeschlossen,
  prioRang,
} from './phase';

export { faelligGruppe, GRUPPE_LABEL, GRUPPE_ORDNUNG } from './gruppierung';
export type { FaelligGruppe } from './gruppierung';

export { default as StatusBadge } from './StatusBadge';
export { default as PrioBadge } from './PrioBadge';
export { default as QuittungIndikator } from './QuittungIndikator';
