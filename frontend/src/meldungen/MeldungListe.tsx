import { Empty } from 'antd';
import type { Meldung, MeldungStatus } from '../api/types';
import MeldungKarte from './MeldungKarte';

export interface BearbeiterOption {
  benutzer_id: number;
  anzeigename: string;
}

export interface MeldungListeProps {
  meldungen: Meldung[];
  /** Steuert die Abschluss-Spalte (Erledigt-Zeitpunkt) der Karte. */
  ansicht?: 'offen' | 'abgeschlossen';
  /** Einsatz-id für den Backlink auf den ausgelösten Auftrag (`/einsaetze/:id/auftraege`). */
  einsatzId: number;
  darfSchreiben?: boolean;
  mitglieder?: BearbeiterOption[];
  onStatus?: (meldungId: number, status: MeldungStatus) => void;
  onZuweisen?: (meldungId: number, bearbeiterId: number | null) => void;
  onLagerelevant?: (meldungId: number) => void;
  onBestaetigen?: (meldungId: number) => void;
  /** Öffnet das Auftrags-Formular zur Meldung→Auftrag-Erteilung (LFH-113). */
  onAuftragErteilen?: (m: Meldung) => void;
}

/**
 * Meldungs-Liste (LFH-112): rendert je Meldung eine MeldungKarte (Karten-Look analog
 * AuftragListe). Die frühere List.Item-/Tag-Darstellung samt lokaler STATUS/PRIO-Tags
 * ist in die Karte gewandert.
 */
export default function MeldungListe({
  meldungen, ansicht = 'offen', einsatzId, darfSchreiben, mitglieder,
  onStatus, onZuweisen, onLagerelevant, onBestaetigen, onAuftragErteilen,
}: MeldungListeProps) {
  if (meldungen.length === 0) return <Empty description="Keine Meldungen" />;
  return (
    <>
      {meldungen.map((m) => (
        <MeldungKarte
          key={m.id}
          meldung={m}
          ansicht={ansicht}
          einsatzId={einsatzId}
          darfSchreiben={darfSchreiben}
          mitglieder={mitglieder}
          onStatus={onStatus}
          onZuweisen={onZuweisen}
          onLagerelevant={onLagerelevant}
          onBestaetigen={onBestaetigen}
          onAuftragErteilen={onAuftragErteilen}
        />
      ))}
    </>
  );
}
