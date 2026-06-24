import { Empty } from 'antd';
import type { Auftrag } from '../api/types';
import AuftragKarte from './AuftragKarte';

export interface AuftragListeProps {
  auftraege: Auftrag[];
  /** Steuert die Read-back-Spalten (Vollzug/Abnahme) in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  /** Für den Rückverweis auf den Quell-ETB-Eintrag (LFH-112). Ohne ihn kein Backlink. */
  einsatzId?: number;
  darfSchreiben?: boolean;
  /** Hervorzuhebender Auftrag (?auftrag=-Deeplink, LFH-153). */
  highlightId?: number | null;
  onQuittieren?: (auftragId: number, empfaengerId: number) => void;
  onInArbeit?: (auftragId: number) => void;
  onVollzugMelden?: (auftragId: number) => void;
  onAbnehmen?: (auftragId: number) => void;
}

/** Kartenboard der Aufträge/Befehle (LFH-112). Reicht alle Props an die einzelne
 *  AuftragKarte durch; Darstellung/Logik liegen vollständig in der Karte. */
export default function AuftragListe({
  auftraege, ansicht = 'offen', einsatzId, darfSchreiben, highlightId,
  onQuittieren, onInArbeit, onVollzugMelden, onAbnehmen,
}: AuftragListeProps) {
  if (auftraege.length === 0) return <Empty description="Keine Aufträge" />;
  return (
    <>
      {auftraege.map((a) => (
        <AuftragKarte
          key={a.id}
          auftrag={a}
          ansicht={ansicht}
          einsatzId={einsatzId}
          darfSchreiben={darfSchreiben}
          hervorgehoben={a.id === highlightId}
          onQuittieren={onQuittieren}
          onInArbeit={onInArbeit}
          onVollzugMelden={onVollzugMelden}
          onAbnehmen={onAbnehmen}
        />
      ))}
    </>
  );
}
